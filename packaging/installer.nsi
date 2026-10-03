; -*- coding: utf-8 -*-
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
Name "O-CUT ${VERSION}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\O-CUT"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
CRCCheck force
BrandingText "O-CUT · AI Music & Video Studio"
Icon "${ICON}"
UninstallIcon "${ICON}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1042 "ProductName" "O-CUT"
VIAddVersionKey /LANG=1042 "FileDescription" "O-CUT 설치 프로그램"
VIAddVersionKey /LANG=1042 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1042 "LegalCopyright" "See THIRD-PARTY-NOTICES.txt"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "NOTICE.ko.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"
Var LocalOnly
Var Backup
Var Previous

; Reject reparse points in the chosen directory and every existing ancestor.
!macro PathGuard PREFIX
Function ${PREFIX}CheckPath
  Exch $0
  Push $1
  Push $2
  System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r1, p 0) i.r2'
  ${If} $2 == 0
  ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
    SetErrorLevel 12
    Quit
  ${EndIf}
  StrCpy $0 $1
guard_loop:
  System::Call 'kernel32::GetFileAttributesW(w r0) i.r1'
  ${If} $1 != -1
    IntOp $2 $1 & 0x400
    ${If} $2 != 0
      MessageBox MB_ICONSTOP|MB_OK "연결된 폴더에는 설치하거나 제거할 수 없습니다." /SD IDOK
      SetErrorLevel 12
      Quit
    ${EndIf}
  ${EndIf}
  ${GetParent} "$0" $1
  StrCmp $1 "" guard_done
  StrCmp $1 $0 guard_done
  StrCpy $0 $1
  Goto guard_loop
guard_done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!macroend
!insertmacro PathGuard ""
!insertmacro PathGuard "un."

Function .onInit
  ; NSIS can silently discard /D when it names a file. Validate the original OS command line.
  System::Call 'kernel32::GetCommandLineW() w.r8'
  StrLen $0 $8
  ${If} $0 >= 1023
    SetErrorLevel 12
    Quit
  ${EndIf}
  StrCpy $2 0
raw_args_loop:
  StrCpy $0 $8 5 $2
  StrCmp $0 ' "/D=' invalid_args
  StrCpy $0 $8 4 $2
  StrCmp $0 "" raw_args_done
  StrCmp $0 " /D=" raw_destination
  IntOp $2 $2 + 1
  Goto raw_args_loop
raw_destination:
  IntOp $2 $2 + 4
  StrCpy $INSTDIR $8 "" $2
  StrCmp $INSTDIR "" invalid_args
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i.r0'
  ${If} $0 != -1
    IntOp $1 $0 & 0x10
    ${If} $1 == 0
      SetErrorLevel 11
      Quit
    ${EndIf}
  ${EndIf}
  Goto raw_args_done
invalid_args:
  SetErrorLevel 21
  Quit
raw_args_done:
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "64비트 Windows가 필요합니다." /SD IDOK
    SetErrorLevel 10
    Quit
  ${EndIf}
  SetShellVarContext current
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/LOCALONLY" $1
  ${If} ${Errors}
    StrCpy $LocalOnly "0"
  ${Else}
    StrCpy $LocalOnly "1"
  ${EndIf}
FunctionEnd

Section "O-CUT"
  System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r0, p 0) i.r1'
  ${If} $1 == 0
  ${OrIf} $1 >= ${NSIS_MAX_STRLEN}
    SetErrorLevel 12
    Quit
  ${EndIf}
  StrCpy $INSTDIR $0
  Push "$INSTDIR"
  Call CheckPath
  ; An existing folder must be empty or owned by this installer.
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i.r0'
  StrCmp $0 -1 checked_folder
  IntOp $1 $0 & 0x10
  ${If} $1 == 0
    SetErrorLevel 11
    Quit
  ${EndIf}
  IfFileExists "$INSTDIR\ocut-install.ini" owned_folder
  StrCpy $1 ""
  FindFirst $0 $1 "$INSTDIR\*"
empty_loop:
  StrCmp $1 "" empty_done
  StrCmp $1 "." empty_next
  StrCmp $1 ".." empty_next
  FindClose $0
  MessageBox MB_ICONSTOP|MB_OK "비어 있는 새 폴더를 선택하세요. 기존 파일은 변경하지 않았습니다." /SD IDOK
  SetErrorLevel 11
  Quit
empty_next:
  FindNext $0 $1
  Goto empty_loop
empty_done:
  FindClose $0
  Goto checked_folder
owned_folder:
  ReadINIStr $0 "$INSTDIR\ocut-install.ini" "O-CUT" "id"
  ${If} $0 != "studio.ocut.desktop"
    SetErrorLevel 12
    Quit
  ${EndIf}
  ReadINIStr $0 "$INSTDIR\ocut-install.ini" "O-CUT" "localOnly"
  ${If} $0 != $LocalOnly
    MessageBox MB_ICONSTOP|MB_OK "이 설치의 기존 설치 방식을 유지해 주세요." /SD IDOK
    SetErrorLevel 12
    Quit
  ${EndIf}
checked_folder:
  ${If} $LocalOnly == "0"
    Push "$SMPROGRAMS\O-CUT"
    Call CheckPath
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\O-CUT" "InstallLocation"
    ${If} $0 == ""
      IfFileExists "$SMPROGRAMS\O-CUT\*" 0 no_foreign_shortcuts
      MessageBox MB_ICONSTOP|MB_OK "기존 시작 메뉴 O-CUT 폴더를 보존하기 위해 설치를 중단했습니다." /SD IDOK
      SetErrorLevel 13
      Quit
no_foreign_shortcuts:
    ${EndIf}
    ${If} $0 != ""
    ${AndIf} $0 != $INSTDIR
      MessageBox MB_ICONSTOP|MB_OK "기존 O-CUT 설치 위치를 선택하세요. 다른 설치는 변경하지 않았습니다." /SD IDOK
      SetErrorLevel 13
      Quit
    ${EndIf}
  ${EndIf}
  Push "$INSTDIR\app"
  Call CheckPath
  IfFileExists "$INSTDIR\app\O-CUT.exe" 0 not_running
  System::Call 'kernel32::CreateFileW(w "$INSTDIR\app\O-CUT.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) i.r0'
  ${If} $0 = -1
    MessageBox MB_ICONSTOP|MB_OK "O-CUT을 종료한 뒤 설치해 주세요. 기존 설치는 보존했습니다." /SD IDOK
    SetErrorLevel 14
    Quit
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p r0)'
not_running:
  IfFileExists "$INSTDIR\.ocut-stage\*" stage_exists
  Push "$INSTDIR\.ocut-stage"
  Call CheckPath
  CreateDirectory "$INSTDIR"
  ClearErrors
  SetOutPath "$INSTDIR\.ocut-stage"
  File /r "${PAYLOAD}\*"
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "파일을 준비하지 못했습니다. 기존 app 폴더는 변경하지 않았습니다." /SD IDOK
    SetErrorLevel 15
    Quit
  ${EndIf}
  SetOutPath "$INSTDIR"
  StrCpy $Previous "0"
  IfFileExists "$INSTDIR\app\*" 0 activate
  System::Call 'kernel32::GetTickCount() i.r0'
  StrCpy $Backup "$INSTDIR\backup-$0"
  IfFileExists "$Backup\*" stage_exists
  ClearErrors
  Rename "$INSTDIR\app" "$Backup"
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "기존 설치를 보존하지 못해 교체를 중단했습니다." /SD IDOK
    SetErrorLevel 16
    Quit
  ${EndIf}
  StrCpy $Previous "1"
activate:
  ClearErrors
  Rename "$INSTDIR\.ocut-stage" "$INSTDIR\app"
  ${If} ${Errors}
    ${If} $Previous == "1"
      Rename "$Backup" "$INSTDIR\app"
    ${EndIf}
    MessageBox MB_ICONSTOP|MB_OK "새 설치를 활성화하지 못했습니다. 이전 설치 또는 backup 폴더를 확인하세요." /SD IDOK
    SetErrorLevel 17
    Quit
  ${EndIf}
  ClearErrors
  WriteINIStr "$INSTDIR\ocut-install.ini" "O-CUT" "id" "studio.ocut.desktop"
  WriteINIStr "$INSTDIR\ocut-install.ini" "O-CUT" "version" "${VERSION}"
  WriteINIStr "$INSTDIR\ocut-install.ini" "O-CUT" "localOnly" "$LocalOnly"
  WriteUninstaller "$INSTDIR\Uninstall O-CUT.exe"
  ${If} $LocalOnly == "0"
    CreateDirectory "$SMPROGRAMS\O-CUT"
    CreateShortcut "$SMPROGRAMS\O-CUT\O-CUT.lnk" "$INSTDIR\app\O-CUT.exe"
    CreateShortcut "$SMPROGRAMS\O-CUT\O-CUT 제거.lnk" "$INSTDIR\Uninstall O-CUT.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\O-CUT" "DisplayName" "O-CUT"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\O-CUT" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\O-CUT" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\O-CUT" "DisplayIcon" "$INSTDIR\app\O-CUT.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\O-CUT" "UninstallString" '"$INSTDIR\Uninstall O-CUT.exe"'
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\O-CUT" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\O-CUT" "NoRepair" 1
  ${EndIf}
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "실행 파일은 준비됐지만 설치 정보 기록에 실패했습니다. 설치 폴더의 app에서 실행할 수 있습니다." /SD IDOK
    SetErrorLevel 20
    Quit
  ${EndIf}
  SetErrorLevel 0
  Goto install_done
stage_exists:
  MessageBox MB_ICONSTOP|MB_OK "이전 설치 준비 파일이 남아 있습니다. 새 빈 폴더를 선택하거나 .ocut-stage 폴더를 확인하세요." /SD IDOK
  SetErrorLevel 18
  Quit
install_done:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Push "$INSTDIR"
  Call un.CheckPath
  Push "$INSTDIR\app"
  Call un.CheckPath
  ReadINIStr $0 "$INSTDIR\ocut-install.ini" "O-CUT" "id"
  ${If} $0 != "studio.ocut.desktop"
    SetErrorLevel 12
    Quit
  ${EndIf}
  ReadINIStr $LocalOnly "$INSTDIR\ocut-install.ini" "O-CUT" "localOnly"
  ${If} $LocalOnly == "0"
    Push "$SMPROGRAMS\O-CUT"
    Call un.CheckPath
  ${EndIf}
  IfFileExists "$INSTDIR\app\O-CUT.exe" 0 un_not_running
  System::Call 'kernel32::CreateFileW(w "$INSTDIR\app\O-CUT.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) i.r0'
  ${If} $0 = -1
    MessageBox MB_ICONSTOP|MB_OK "O-CUT을 종료한 뒤 제거해 주세요." /SD IDOK
    SetErrorLevel 14
    Quit
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p r0)'
un_not_running:
  !include "${UNINSTALL_FILES}"
  IfFileExists "$INSTDIR\app\O-CUT.exe" un_failed
  ${If} $LocalOnly == "0"
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\O-CUT" "InstallLocation"
    ${If} $0 == $INSTDIR
      ClearErrors
      DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\O-CUT"
      IfErrors un_failed
      Delete "$SMPROGRAMS\O-CUT\O-CUT.lnk"
      Delete "$SMPROGRAMS\O-CUT\O-CUT 제거.lnk"
      IfFileExists "$SMPROGRAMS\O-CUT\O-CUT.lnk" un_failed
      IfFileExists "$SMPROGRAMS\O-CUT\O-CUT 제거.lnk" un_failed
      RMDir "$SMPROGRAMS\O-CUT"
    ${EndIf}
  ${EndIf}
  Delete "$INSTDIR\ocut-install.ini"
  Delete "$INSTDIR\Uninstall O-CUT.exe"
  SetOutPath "$TEMP"
  RMDir "$INSTDIR"
  SetErrorLevel 0
  Goto un_done
un_failed:
  SetErrorLevel 19
un_done:
SectionEnd
