# installer.py
import sys
import os
import subprocess
import time
import traceback
import requests
import math
from threading import Event
from pathlib import Path

from PyQt6.QtWidgets import (
    QApplication, QWizard, QWizardPage, QVBoxLayout, QLabel,
    QLineEdit, QPushButton, QFileDialog, QProgressBar,
    QMessageBox, QCheckBox, QHBoxLayout, QWidget, QSpacerItem, QSizePolicy
)
from PyQt6.QtCore import QThread, pyqtSignal, QPropertyAnimation, QEasingCurve, Qt
from PyQt6.QtGui import QFont, QIcon

# Windows-specific imports
try:
    from winreg import HKEY_CURRENT_USER, CreateKey, SetValueEx, REG_SZ
except Exception:
    HKEY_CURRENT_USER = None

# ---------------------------
# Config - update these
# ---------------------------
CDN_EXE_URL = "http://4.213.152.243/agent.exe"  # URL to agent.exe
EXE_FILENAME = "agent.exe"
REQUIRED_PACKAGES = []  # not auto-installed in production builds
APP_NAME = "SystemMonitorAgent"
STARTUP_REG_NAME = "SystemMonitorAgent"

# ---------------------------
# Utility helpers
# ---------------------------
def sizeof_fmt(num, suffix="B"):
    # human readable bytes
    for unit in ["", "K", "M", "G", "T", "P"]:
        if abs(num) < 1024.0:
            return f"{num:3.1f}{unit}{suffix}"
        num /= 1024.0
    return f"{num:.1f}P{suffix}"


# ---------------------------
# Install Worker Thread
# ---------------------------
class InstallWorker(QThread):
    progress = pyqtSignal(int)
    status = pyqtSignal(str)
    finished = pyqtSignal(bool, str)

    def __init__(self, install_path: str, agent_id: str, backend_url: str, parent=None):
        super().__init__(parent)
        self.install_path = os.path.abspath(install_path)
        self.agent_id = agent_id.strip()
        self.backend_url = backend_url.strip()
        self.tmp_event = Event()
        self._stop = False

    def stop(self):
        self._stop = True
        self.tmp_event.set()

    def check_cdn(self):
        self.status.emit("Checking update server...")
        try:
            r = requests.head(CDN_EXE_URL, timeout=6)
            if r.status_code == 200:
                cl = r.headers.get("content-length")
                size = int(cl) if cl and cl.isdigit() else None
                if size:
                    self.status.emit(f"Package size: {sizeof_fmt(size)}")
                return True
            else:
                self.status.emit(f"Server returned {r.status_code}")
                return False
        except Exception as e:
            self.status.emit(f"CDN check failed: {e}")
            return False

    def download_exe(self, dest_path):
        self.status.emit("Downloading agent...")
        try:
            with requests.get(CDN_EXE_URL, stream=True, timeout=20) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0) or 0)
                downloaded = 0
                last_emit = 0
                start = time.time()
                with open(dest_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        if self._stop:
                            return False
                        if chunk:
                            f.write(chunk)
                            downloaded += len(chunk)
                            elapsed = max(0.0001, time.time() - start)
                            speed = downloaded / elapsed
                            percent = 0
                            if total:
                                percent = int((downloaded / total) * 60)  # allocate 60% of progress bar for download
                            else:
                                # if unknown total, use a heuristic
                                percent = min(60, int(math.log1p(downloaded) % 60))
                            # emit fewer signals to avoid UI flooding
                            if int(time.time() * 10) != last_emit:
                                self.progress.emit(10 + percent)
                                last_emit = int(time.time() * 10)
                                self.status.emit(f"Downloading: {sizeof_fmt(downloaded)} at {sizeof_fmt(speed)}/s")
                # make executable (best effort)
                try:
                    os.chmod(dest_path, 0o755)
                except Exception:
                    pass
                self.progress.emit(70)
                return True
        except Exception as e:
            self.status.emit(f"Download failed: {e}")
            return False

    def add_registry_startup(self, exe_path):
        if HKEY_CURRENT_USER is None:
            self.status.emit("Registry not available on this OS.")
            return False
        try:
            key = CreateKey(HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run")
            SetValueEx(key, STARTUP_REG_NAME, 0, REG_SZ, exe_path)
            self.status.emit("Added startup entry (registry).")
            return True
        except Exception as e:
            self.status.emit(f"Registry startup failed: {e}")
            return False

    def add_startup_folder(self, exe_path):
        # Create a small .bat in the user's startup folder to run the exe
        try:
            startup = os.path.join(os.getenv("APPDATA"), r"Microsoft\Windows\Start Menu\Programs\Startup")
            os.makedirs(startup, exist_ok=True)
            bat_path = os.path.join(startup, f"{APP_NAME}.bat")
            # use start to detach
            content = f'start "" "{exe_path}"\r\n'
            with open(bat_path, "w", encoding="utf-8") as f:
                f.write(content)
            self.status.emit("Added startup entry (Startup folder).")
            return True
        except Exception as e:
            self.status.emit(f"Startup-folder entry failed: {e}")
            return False

    def run(self):
        try:
            os.makedirs(self.install_path, exist_ok=True)
            self.progress.emit(5)
            self.status.emit("Preparing installation...")

            if not self.check_cdn():
                self.finished.emit(False, "Update server unreachable.")
                return

            # Write .env
            self.progress.emit(12)
            self.status.emit("Writing configuration (.env)...")
            try:
                env_content = f"AGENT_ID={self.agent_id}\nBACKEND_URL={self.backend_url}\nUPDATE_URL={CDN_EXE_URL}\n"
                env_path = os.path.join(self.install_path, ".env")
                with open(env_path, "w", encoding="utf-8") as ef:
                    ef.write(env_content)
                self.status.emit(".env saved.")
            except Exception as e:
                self.status.emit(f".env write failed: {e}")

            # Download EXE
            exe_dest = os.path.join(self.install_path, EXE_FILENAME)
            self.progress.emit(20)
            ok = self.download_exe(exe_dest)
            if not ok:
                self.finished.emit(False, "Failed to download agent executable.")
                return

            # small extraction/placement animations
            self.progress.emit(75)
            self.status.emit("Finalizing installation...")
            time.sleep(0.6)

            # add startup entries
            reg_ok = self.add_registry_startup(exe_dest)
            bat_ok = self.add_startup_folder(exe_dest)
            if not (reg_ok or bat_ok):
                # not fatal, warn user
                self.status.emit("Warning: could not add to startup automatically.")
            else:
                self.status.emit("Startup registration complete.")

            # launch agent
            self.status.emit("Starting agent...")
            try:
                # start detached
                if sys.platform.startswith("win"):
                    CREATE_NO_WINDOW = 0x08000000
                    subprocess.Popen([exe_dest], shell=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     stdin=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW)
                else:
                    subprocess.Popen([exe_dest], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
            except Exception as e:
                self.status.emit(f"Failed to start agent: {e}")

            self.progress.emit(100)
            self.status.emit("Installation completed successfully.")
            self.finished.emit(True, f"Installation complete!\nInstalled to:\n{self.install_path}")

        except Exception as e:
            tb = traceback.format_exc()
            self.finished.emit(False, f"Error during installation:\n{e}\n\n{tb}")


# ---------------------------
# Wizard Pages
# ---------------------------
class TitleLabel(QLabel):
    def __init__(self, text):
        super().__init__(text)
        f = QFont()
        f.setPointSize(12)
        f.setBold(True)
        self.setFont(f)
        self.setWordWrap(True)


class WelcomePage(QWizardPage):
    def __init__(self):
        super().__init__()
        self.setTitle("Welcome")
        layout = QVBoxLayout()
        layout.setSpacing(12)
        lbl = TitleLabel("Welcome to the System Monitor Agent Installer")
        desc = QLabel("This wizard will guide you through installing the System Monitor Agent. Click Next to continue.")
        desc.setWordWrap(True)
        layout.addWidget(lbl)
        layout.addWidget(desc)
        self.setLayout(layout)


class ConfigPage(QWizardPage):
    def __init__(self):
        super().__init__()
        self.setTitle("Configuration")
        layout = QVBoxLayout()
        layout.setSpacing(8)
        self.agent_id = QLineEdit()
        self.backend = QLineEdit()
        self.agent_id.setPlaceholderText("e.g. SERVER-001")
        self.backend.setPlaceholderText("https://admin.example.com")
        layout.addWidget(QLabel("Agent ID:"))
        layout.addWidget(self.agent_id)
        layout.addWidget(QLabel("Backend URL:"))
        layout.addWidget(self.backend)
        self.setLayout(layout)

    def validatePage(self):
        if not self.agent_id.text().strip():
            QMessageBox.warning(self, "Missing", "Agent ID cannot be empty.")
            return False
        if not self.backend.text().strip():
            QMessageBox.warning(self, "Missing", "Backend URL cannot be empty.")
            return False
        return True


class DirectoryPage(QWizardPage):
    def __init__(self):
        super().__init__()
        self.setTitle("Installation Folder")
        layout = QVBoxLayout()
        layout.setSpacing(8)
        self.path = QLineEdit()
        browse = QPushButton("Browse...")
        browse.clicked.connect(self.browse_folder)
        layout.addWidget(QLabel("Choose where to install the agent:"))
        row = QHBoxLayout()
        row.addWidget(self.path)
        row.addWidget(browse)
        layout.addLayout(row)
        self.setLayout(layout)

    def browse_folder(self):
        p = QFileDialog.getExistingDirectory(self, "Select folder")
        if p:
            self.path.setText(p)

    def validatePage(self):
        p = self.path.text().strip()
        if not p:
            QMessageBox.warning(self, "Missing", "Please choose an installation folder.")
            return False
        # check write permission
        try:
            os.makedirs(p, exist_ok=True)
            testfile = os.path.join(p, ".write_test")
            with open(testfile, "w") as f:
                f.write("test")
            os.remove(testfile)
            return True
        except Exception as e:
            QMessageBox.critical(self, "Invalid folder", f"Cannot write to folder: {e}")
            return False


class InstallPage(QWizardPage):
    def __init__(self):
        super().__init__()
        self.setTitle("Installing")
        layout = QVBoxLayout()
        layout.setSpacing(8)
        self.status = QLabel("Ready to install...")
        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        self.progress.setValue(0)
        self.progress.setTextVisible(True)
        layout.addWidget(self.status)
        layout.addWidget(self.progress)
        self.setLayout(layout)
        self.worker = None

        # animation for progress bar
        self.anim = QPropertyAnimation(self.progress, b"value", self)
        self.anim.setEasingCurve(QEasingCurve.Type.InOutQuad)
        self.anim.setDuration(300)

    def initializePage(self):
        install_path = self.wizard().page(2).path.text().strip()
        agent_id = self.wizard().page(1).agent_id.text().strip()
        backend = self.wizard().page(1).backend.text().strip()
        self.worker = InstallWorker(install_path, agent_id, backend)
        self.worker.progress.connect(self.set_progress)
        self.worker.status.connect(self.set_status)
        self.worker.finished.connect(self.on_finished)
        self.worker.start()
        self.set_status("Starting installation...")

    def set_progress(self, v):
        # animate to new value
        self.anim.stop()
        self.anim.setStartValue(self.progress.value())
        self.anim.setEndValue(v)
        self.anim.start()

    def set_status(self, text):
        self.status.setText(text)

    def on_finished(self, ok: bool, msg: str):
        self.set_status(msg)
        if ok:
            self.set_progress(100)
            QMessageBox.information(self, "Installed", msg)
            # allow next
            self.wizard().next()
        else:
            QMessageBox.critical(self, "Failed", msg)


class FinishPage(QWizardPage):
    def __init__(self):
        super().__init__()
        self.setTitle("Finished")
        layout = QVBoxLayout()
        layout.setSpacing(10)
        lbl = QLabel("Installation finished.")
        lbl.setWordWrap(True)
        lbl.setAlignment(Qt.AlignmentFlag.AlignLeft)
        self.launch_cb = QCheckBox("Launch agent now")
        layout.addWidget(lbl)
        layout.addWidget(self.launch_cb)
        self.setLayout(layout)

    def cleanupPage(self):
        if self.launch_cb.isChecked():
            # try to start the installed agent
            try:
                inst_path = self.wizard().page(2).path.text().strip()
                exe = os.path.join(inst_path, EXE_FILENAME)
                if os.path.exists(exe):
                    if sys.platform.startswith("win"):
                        CREATE_NO_WINDOW = 0x08000000
                        subprocess.Popen([exe], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                         stdin=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW)
                    else:
                        subprocess.Popen([exe], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
                    QMessageBox.information(self, "Started", "Agent started.")
                else:
                    QMessageBox.warning(self, "Missing", "Agent executable not found.")
            except Exception as e:
                QMessageBox.warning(self, "Start failed", f"Could not start agent: {e}")


# ---------------------------
# Installer Wizard
# ---------------------------
class InstallerWizard(QWizard):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("System Monitor Agent Installer")
        self.setWindowIcon(QIcon(self.resource_path("icon.ico")))
        self.setFixedSize(600, 420)
        self.setWizardStyle(QWizard.WizardStyle.ModernStyle)
        self.addPage(WelcomePage())
        self.addPage(ConfigPage())
        self.addPage(DirectoryPage())
        self.addPage(InstallPage())
        self.addPage(FinishPage())

    @staticmethod
    def resource_path(relative):
        # When running as onefile exe, PyInstaller extracts files to temp
        try:
            base = sys._MEIPASS  # type: ignore
        except Exception:
            base = os.path.abspath(".")
        return os.path.join(base, relative)


# ---------------------------
# Main
# ---------------------------
def main():
    app = QApplication(sys.argv)
    app.setApplicationDisplayName("System Monitor Agent Installer")
    # set a global font
    f = QFont("Segoe UI", 9)
    app.setFont(f)

    wizard = InstallerWizard()
    wizard.show()
    return app.exec()

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        QMessageBox.critical(None, "Fatal", "An unexpected error occurred. See console for details.")
