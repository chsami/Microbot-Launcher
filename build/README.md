# Microbot Launcher for macOS

## 📋 Installation Instructions

1. Open the DMG file
2. Drag "Microbot Launcher" to the Applications folder
3. **IMPORTANT:** Before launching the app:
   - Run the "Fix Permissions" script (included in this DMG)
   - OR open Terminal and run: `xattr -cr "/Applications/Microbot Launcher.app"`

## ⚠️ "App is damaged" Warning

If you see a message saying the app is damaged or can't be opened:

### Method 1: Fix Permissions Script
1. Double-click the "Fix Permissions" script in this DMG
2. Enter your administrator password when prompted
3. Launch the app normally

### Method 2: Right-click Method
1. Right-click (or Ctrl+click) on the app in Applications
2. Select "Open" from the context menu
3. Click "Open" when prompted

### Method 3: Manual Terminal Command
1. Open Terminal (from Applications > Utilities)
2. Copy and paste: `xattr -cr "/Applications/Microbot Launcher.app"`
3. Press Enter and provide your password if prompted

## 🔍 Why This Happens

This warning appears because the app isn't signed with an Apple Developer certificate. This doesn't mean the app is unsafe - it's simply a security feature in macOS that we're bypassing.

## 💻 System Requirements
- macOS 10.14 or later
- Intel or Apple Silicon Mac

For more information or support, visit our website.