import time
import secrets
from time import sleep
import os

print("BlopperBold Pulse Updater (C)")

sleep(1)

os.system("taskkill /im node.exe /f")

sleep(1)

os.system("cd Blopperbold-Nexus")

os.system("git pull")

os.system("start C:\\Users\\Neu\\Desktop\\startserver.bat")

print("Update Abgeschlossen")
