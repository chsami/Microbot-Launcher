display dialog "Fix Microbot Launcher so it can run?\n\nThis will remove the quarantine flag macOS adds to downloaded apps so you don't see the damaged / cannot be opened warning." buttons {"Cancel", "Fix"} default button "Fix"

set appPath to "/Applications/Microbot Launcher.app"
do shell script "/usr/bin/xattr -dr com.apple.quarantine " & quoted form of appPath with administrator privileges

display dialog "Done! You can now open Microbot Launcher normally from Applications." buttons {"OK"} default button "OK"
