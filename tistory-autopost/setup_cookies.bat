@echo off
rem 이 파일은 CP949(한글 Windows 기본) 인코딩. 오류가 나도 창이 닫히지 않도록 cmd /k 로 다시 실행
if /i not "%~1"=="__run" (
  cmd /k ""%~f0" __run"
  exit /b
)
title 티스토리 쿠키 추출 (1회 설정)
cd /d "%~dp0"
echo ========================================================
echo   티스토리 자동 포스팅 - 로그인 쿠키 추출 (최초 1회)
echo ========================================================
echo.

rem --- 1. Python 확인 ---
rem  (Microsoft Store 바로가기 python 은 실제 실행이 안 되므로 --version 으로 확인)
set "PY="
python --version >nul 2>&1 && set "PY=python"
if not defined PY py --version >nul 2>&1 && set "PY=py"
if not defined PY (
  echo [오류] Python 이 설치되어 있지 않음
  echo  - 열리는 페이지에서 Python 설치, 첫 화면의 "Add python.exe to PATH" 반드시 체크
  echo  - 설치 후 이 파일을 다시 더블클릭
  start https://www.python.org/downloads/
  pause
  exit /b 1
)
echo [1/6] Python 확인: 
%PY% --version
echo.

rem --- 2. 패키지 설치 ---
echo [2/6] 필요한 패키지 설치 중 (1~2분)...
%PY% -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo [오류] 패키지 설치 실패 - 위 오류 문구를 Claude 에게 전달
  pause
  exit /b 1
)
echo.

rem --- 3. 블로그명 ---
set "BLOG=hoonnsol"
set /p "BLOG=[3/6] 블로그명 입력 (그냥 Enter = hoonnsol): "
set "TISTORY_BLOG_NAME=%BLOG%"
set "TISTORY_HEADLESS=0"
echo   블로그: https://%BLOG%.tistory.com
echo.

rem --- 4. 로그인 ---
echo [4/6] Chrome 창이 열리면 [카카오계정으로 로그인] 후 카카오톡 승인까지 완료
echo       로그인이 끝나면 Chrome 창은 그대로 두고, 이 검은 창으로 돌아와 Enter
echo       (Enter 전에 Chrome 창을 닫지 말 것)
%PY% tistory_poster.py --login
echo.

rem --- 5. 쿠키 확인 (로그인 단계에서 바로 저장됨, 없을 때만 다시 추출) ---
echo [5/6] 쿠키 확인 중...
if not exist tistory_cookies.txt %PY% tistory_poster.py --export-cookies
if not exist tistory_cookies.txt (
  echo [오류] 쿠키 파일이 만들어지지 않음 - 로그인이 안 된 상태. 이 파일을 다시 실행
  pause
  exit /b 1
)
echo.

rem --- 6. Secret 등록 ---
echo [6/6] GitHub Secret 등록
type tistory_cookies.txt | clip
echo  (1) 쿠키 값을 클립보드에 복사함. 열리는 페이지에서:
echo      Name = TISTORY_COOKIES  /  Secret 칸에 Ctrl+V  /  [Add secret] 클릭
start https://github.com/remnant1981-bit/remnant1981/settings/secrets/actions/new
pause

%PY% -c "import secrets,sys; sys.stdout.write(secrets.token_urlsafe(32))" | clip
echo  (2) SESSION_KEY 값을 클립보드에 복사함. 열리는 페이지에서:
echo      Name = SESSION_KEY  /  Secret 칸에 Ctrl+V  /  [Add secret] 클릭
start https://github.com/remnant1981-bit/remnant1981/settings/secrets/actions/new
pause

del /q tistory_cookies.txt >nul 2>&1
echo.| clip
echo.
echo ========================================================
echo   완료. 쿠키 파일과 클립보드는 지웠음
echo   Claude 에게 "등록 완료" 라고 알려주면 로그인 점검 진행
echo ========================================================
pause
