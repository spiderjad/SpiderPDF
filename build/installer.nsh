; Añadidos al instalador NSIS de SpiderPDF. electron-builder lo incluye solo (nsis.include = build/installer.nsh).
;
; (C) SpiderPDF como aplicación capaz de abrir los PDF. electron-builder ya registra el ProgId (fileAssociations en
; package.json) y OpenWithProgids; aquí se añade lo que Windows necesita para listar SpiderPDF en «Aplicaciones
; predeterminadas»: Capabilities + RegisteredApplications, y Applications\SpiderPDF.exe para «Abrir con».
; Windows no deja que un programa se ponga como predeterminado: la página final ofrece abrir la configuración con
; SpiderPDF ya elegido (ms-settings:defaultapps?registeredAppMachine|registeredAppUser=SpiderPDF; Windows 11 22H2+,
; en Windows 10 abre la página general). SHELL_CONTEXT = HKLM (para todos los usuarios) o HKCU (solo para mí).
; Al desinstalar (no al actualizar) se borra todo, también el .pdf → ProgId que deja electron-builder.

!define SPIDER_PROGID "Documento PDF" ; = build.fileAssociations[0].name. No cambiarlo: es el ProgId que Windows guarda
                                      ; como predeterminado (UserChoice) a quien ya eligió SpiderPDF.
!define SPIDER_CAPS "Software\SpiderPDF\Capabilities"
!define SPIDER_APPKEY "Software\Classes\Applications\SpiderPDF.exe"

!ifndef BUILD_UNINSTALLER
  ; Textos (1033 inglés, 3082 español, 1027 catalán; en el resto de idiomas del instalador, el inglés).
  LangString spiderDefaultApp 1033 "Make SpiderPDF the default app for PDF files"
  LangString spiderDefaultApp 3082 "Elegir SpiderPDF como aplicación predeterminada para los PDF"
  LangString spiderDefaultApp 1027 "Tria SpiderPDF com a aplicació predeterminada per als PDF"
  LangString spiderAppDescription 1033 "Read, edit, sign and convert PDF files."
  LangString spiderAppDescription 3082 "Lee, edita, firma y convierte archivos PDF."
  LangString spiderAppDescription 1027 "Llegeix, edita, signa i converteix fitxers PDF."
!endif

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${SPIDER_CAPS}" "ApplicationName" "SpiderPDF"
  WriteRegStr SHELL_CONTEXT "${SPIDER_CAPS}" "ApplicationDescription" "$(spiderAppDescription)"
  WriteRegStr SHELL_CONTEXT "${SPIDER_CAPS}" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${SPIDER_CAPS}\FileAssociations" ".pdf" "${SPIDER_PROGID}"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "SpiderPDF" "${SPIDER_CAPS}"

  ; El ProgId con el nombre y el icono de la app (la configuración de Windows los muestra).
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SPIDER_PROGID}\Application" "ApplicationName" "SpiderPDF"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SPIDER_PROGID}\Application" "ApplicationIcon" "$appExe,0"

  ; «Abrir con» → SpiderPDF, solo para PDF.
  WriteRegStr SHELL_CONTEXT "${SPIDER_APPKEY}" "FriendlyAppName" "SpiderPDF"
  WriteRegStr SHELL_CONTEXT "${SPIDER_APPKEY}\SupportedTypes" ".pdf" ""
  WriteRegStr SHELL_CONTEXT "${SPIDER_APPKEY}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${SPIDER_APPKEY}\shell\open\command" "" '"$appExe" "%1"'

  !insertmacro UPDATEFILEASSOC
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "SpiderPDF"
    DeleteRegKey SHELL_CONTEXT "${SPIDER_CAPS}"
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\SpiderPDF"
    DeleteRegKey SHELL_CONTEXT "${SPIDER_APPKEY}"
    ; electron-builder pone .pdf → «Documento PDF» y al desinstalar no lo devuelve: sin esto, en una instalación «solo
    ; para mí» quedaría .pdf apuntando a un ProgId que ya no existe.
    ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.pdf" ""
    ${if} $0 == "${SPIDER_PROGID}"
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdf" ""
    ${endif}
    System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0x1000, 0, 0)'
  ${endIf}
!macroend

; Página final: la casilla de siempre («Ejecutar SpiderPDF») y otra para elegirlo como predeterminado. Marcada,
; salvo que SpiderPDF ya sea el predeterminado de los .pdf para este usuario.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function spiderOpenDefaultApps
    ${if} $installMode == "all"
      StrCpy $1 "ms-settings:defaultapps?registeredAppMachine=SpiderPDF"
    ${else}
      StrCpy $1 "ms-settings:defaultapps?registeredAppUser=SpiderPDF"
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$1" "open" ""
  FunctionEnd

  Function spiderFinishShow
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice" "ProgId"
    ${if} $0 == "${SPIDER_PROGID}"
      SendMessage $mui.FinishPage.ShowReadme ${BM_SETCHECK} 0 0
    ${endif}
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "$(spiderDefaultApp)"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "spiderOpenDefaultApps"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW spiderFinishShow
  !insertmacro MUI_PAGE_FINISH
!macroend
