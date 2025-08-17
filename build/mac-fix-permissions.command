#!/bin/bash
# Script to fix permissions for Microbot Launcher on macOS
# This script removes the quarantine attribute that causes the "app is damaged" warning

# Determine app location
APP_PATH="/Applications/Microbot Launcher.app"
if [ ! -d "$APP_PATH" ]; then
  echo "❌ Microbot Launcher not found in Applications folder"
  echo "Please drag the app to your Applications folder first, then run this script again."
  read -p "Press Enter to exit..."
  exit 1
fi

echo "🔍 Found Microbot Launcher at $APP_PATH"
echo "🔑 Requesting admin privileges to fix permissions..."

# Use sudo to run xattr with admin privileges
sudo xattr -cr "$APP_PATH"

if [ $? -eq 0 ]; then
  echo "✅ Successfully removed quarantine attribute!"
  echo "🚀 You can now launch Microbot Launcher from your Applications folder."
else
  echo "❌ Failed to remove quarantine attribute"
  echo "Please try opening Terminal and manually running:"
  echo "sudo xattr -cr \"$APP_PATH\""
fi

echo "---------------------------------------"
echo "You can also open the app by right-clicking on it"
echo "and selecting 'Open' from the context menu."
echo "When prompted, click 'Open' to bypass Gatekeeper once."
echo "---------------------------------------"
read -p "Press Enter to exit..."
