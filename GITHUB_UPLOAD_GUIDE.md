# GitHub 저장소 업로드 가이드

기존 GitHub 저장소(`https://github.com/BeomJuGo/pc-site-backend`)의 모든 파일을 삭제하고 현재 로컬 파일들을 새로 업로드하는 방법입니다.

## 📋 방법 1: Force Push로 완전히 덮어쓰기 (권장)

### 단계별 실행

#### 1단계: Git 저장소 초기화 및 원격 저장소 연결

```powershell
# 현재 디렉토리로 이동
cd C:\Users\lom00\Desktop\pc-site-backend-main

# Git 저장소 초기화
git init

# 원격 저장소 추가
git remote add origin https://github.com/BeomJuGo/pc-site-backend.git

# 기존 원격 저장소의 내용 가져오기 (히스토리 확인용)
git fetch origin
```

#### 2단계: 모든 파일 스테이징 및 커밋

```powershell
# .gitignore 파일이 있다면 확인 (node_modules 등 제외)
# 없다면 생성 권장

# 모든 파일 추가
git add .

# 커밋
git commit -m "Replace all files with new backend code"
```

#### 3단계: 기존 브랜치를 강제로 덮어쓰기

```powershell
# main 브랜치로 체크아웃 (없으면 생성)
git checkout -b main

# 기존 원격 저장소의 모든 내용을 현재 로컬 내용으로 강제 덮어쓰기
git push -f origin main
```

**⚠️ 주의**: `-f` (force) 옵션은 기존 저장소의 모든 히스토리를 덮어씁니다. 신중하게 사용하세요.

---

## 📋 방법 2: 기존 저장소 클론 후 교체

### 단계별 실행

#### 1단계: 기존 저장소 클론

```powershell
# 임시 폴더에 클론
cd C:\Users\lom00\Desktop
git clone https://github.com/BeomJuGo/pc-site-backend.git temp-backend
cd temp-backend
```

#### 2단계: 모든 파일 삭제 (Git 히스토리 유지)

```powershell
# .git 폴더와 .gitignore 제외하고 모든 파일 삭제
git rm -rf .
# 또는 PowerShell에서
Get-ChildItem -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force
```

#### 3단계: 새 파일들 복사

```powershell
# 현재 백엔드 파일들을 복사
Copy-Item -Path "C:\Users\lom00\Desktop\pc-site-backend-main\*" -Destination "." -Recurse -Exclude ".git"
```

#### 4단계: 새 파일들 추가 및 푸시

```powershell
# 모든 파일 추가
git add .

# 커밋
git commit -m "Replace all files with new backend code"

# 푸시
git push origin main
```

---

## 📋 방법 3: 완전히 새로 시작 (가장 간단)

### 단계별 실행

```powershell
# 1. 현재 디렉토리로 이동
cd C:\Users\lom00\Desktop\pc-site-backend-main

# 2. Git 초기화
git init

# 3. 원격 저장소 추가
git remote add origin https://github.com/BeomJuGo/pc-site-backend.git

# 4. .gitignore 파일 생성 (선택사항이지만 권장)
# node_modules, .env 등은 제외해야 함

# 5. 모든 파일 추가
git add .

# 6. 첫 커밋
git commit -m "Initial commit: New backend code"

# 7. main 브랜치로 이름 변경
git branch -M main

# 8. 강제 푸시 (기존 내용 덮어쓰기)
git push -f origin main
```

---

## 🔧 .gitignore 파일 생성 (권장)

업로드 전에 `.gitignore` 파일을 생성하여 불필요한 파일들이 업로드되지 않도록 하세요:

```powershell
# .gitignore 파일 생성
@"
node_modules/
.env
.env.local
*.log
.DS_Store
dist/
build/
.vscode/
.idea/
*.swp
*.swo
*~
"@ | Out-File -FilePath ".gitignore" -Encoding utf8
```

---

## ⚠️ 주의사항

1. **환경 변수 파일**: `.env` 파일은 절대 업로드하지 마세요. `.gitignore`에 추가하세요.

2. **node_modules**: 용량이 크므로 `.gitignore`에 추가하세요.

3. **Force Push**: `git push -f`는 기존 히스토리를 완전히 덮어씁니다. 팀 프로젝트라면 팀원들과 상의하세요.

4. **백업**: 중요한 데이터가 있다면 미리 백업하세요.

5. **인증**: GitHub에 푸시하려면 인증이 필요합니다:
   - Personal Access Token (PAT)
   - SSH 키
   - GitHub CLI

---

## 🚀 빠른 실행 스크립트 (PowerShell)

다음 스크립트를 PowerShell에서 실행하면 자동으로 처리됩니다:

```powershell
# 현재 디렉토리로 이동
cd C:\Users\lom00\Desktop\pc-site-backend-main

# Git 초기화
git init

# 원격 저장소 추가 (이미 있으면 제거 후 재추가)
git remote remove origin 2>$null
git remote add origin https://github.com/BeomJuGo/pc-site-backend.git

# .gitignore 생성 (없는 경우)
if (-not (Test-Path .gitignore)) {
    @"
node_modules/
.env
*.log
.DS_Store
dist/
build/
"@ | Out-File -FilePath ".gitignore" -Encoding utf8
}

# 모든 파일 추가
git add .

# 커밋
git commit -m "Replace all files with new backend code"

# 브랜치 이름을 main으로 설정
git branch -M main

# 강제 푸시
Write-Host "⚠️ 기존 저장소의 모든 내용을 덮어씁니다. 계속하시겠습니까? (Y/N)"
$confirm = Read-Host
if ($confirm -eq "Y" -or $confirm -eq "y") {
    git push -f origin main
    Write-Host "✅ 업로드 완료!"
} else {
    Write-Host "❌ 취소되었습니다."
}
```

---

## 📝 GitHub 인증 설정

### Personal Access Token 사용

1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. "Generate new token" 클릭
3. 권한 선택: `repo` (전체 저장소 접근)
4. 토큰 생성 후 복사
5. 푸시 시 비밀번호 대신 토큰 사용

### SSH 키 사용

```powershell
# SSH 키 생성 (없는 경우)
ssh-keygen -t ed25519 -C "your_email@example.com"

# 공개 키를 GitHub에 등록
# GitHub → Settings → SSH and GPG keys → New SSH key
```

원격 저장소 URL을 SSH로 변경:
```powershell
git remote set-url origin git@github.com:BeomJuGo/pc-site-backend.git
```

---

**마지막 업데이트**: 2025년 1월

