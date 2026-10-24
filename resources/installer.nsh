; MemoFloat custom NSIS hooks (included by electron-builder).
;
; Upgrades never touch user data. On a manual uninstall the user is asked explicitly whether
; notes, reminders and settings should also be deleted. The default answer is "No" (keep),
; and silent uninstalls always keep the data.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Do you also want to permanently delete your MemoFloat notes, reminders and settings?$\r$\n$\r$\nChoose No to keep your data (recommended). It is stored in:$\r$\n$APPDATA\MemoFloat" /SD IDNO IDNO memofloatKeepData
      RMDir /r "$APPDATA\MemoFloat"
    memofloatKeepData:
  ${endIf}
!macroend
