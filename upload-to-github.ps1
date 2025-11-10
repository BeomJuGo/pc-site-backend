# GitHub 업로드 자동화 스크립트
# 기존 저장소의 모든 파일을 삭제하고 현재 파일들을 업로드합니다.

Write-Host "🚀 GitHub 업로드 시작..." -ForegroundColor Green

# 현재 디렉토리 확인
$currentDir = Get-Location
Write-Host "현재 디렉토리: $currentDir" -ForegroundColor Cyan

# Git 초기화
Write-Host "`n📦 Git 저장소 초기화 중..." -ForegroundColor Yellow
if (Test-Path .git) {
    Write-Host "이미 Git 저장소입니다." -ForegroundColor Yellow
} else {
    git init
    Write-Host "✅ Git 저장소 초기화 완료" -ForegroundColor Green
}

# 원격 저장소 설정
Write-Host "`n🔗 원격 저장소 설정 중..." -ForegroundColor Yellow
git remote remove origin 2>$null
git remote add origin https://github.com/BeomJuGo/pc-site-backend.git
Write-Host "✅ 원격 저장소 연결 완료" -ForegroundColor Green

# .gitignore 확인
if (-not (Test-Path .gitignore)) {
    Write-Host "`n⚠️ .gitignore 파일이 없습니다. 생성 중..." -ForegroundColor Yellow
    @"
node_modules/
.env
*.log
.DS_Store
dist/
build/
"@ | Out-File -FilePath ".gitignore" -Encoding utf8
    Write-Host "✅ .gitignore 파일 생성 완료" -ForegroundColor Green
}

# 파일 추가
Write-Host "`n📝 파일 추가 중..." -ForegroundColor Yellow
git add .
$fileCount = (git status --short | Measure-Object -Line).Lines
Write-Host "✅ $fileCount 개의 파일이 추가되었습니다." -ForegroundColor Green

# 커밋
Write-Host "`n💾 커밋 중..." -ForegroundColor Yellow
git commit -m "Replace all files with new backend code" 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ 커밋 완료" -ForegroundColor Green
} else {
    Write-Host "⚠️ 커밋할 변경사항이 없거나 이미 커밋되었습니다." -ForegroundColor Yellow
}

# 브랜치 설정
Write-Host "`n🌿 브랜치 설정 중..." -ForegroundColor Yellow
git branch -M main
Write-Host "✅ main 브랜치로 설정 완료" -ForegroundColor Green

# 확인 메시지
Write-Host "`n⚠️  경고: 기존 GitHub 저장소의 모든 내용을 덮어씁니다!" -ForegroundColor Red
Write-Host "계속하시겠습니까? (Y/N): " -NoNewline -ForegroundColor Yellow
$confirm = Read-Host

if ($confirm -eq "Y" -or $confirm -eq "y") {
    Write-Host "`n🚀 GitHub에 푸시 중..." -ForegroundColor Yellow
    git push -f origin main
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✅ 업로드 완료!" -ForegroundColor Green
        Write-Host "저장소 주소: https://github.com/BeomJuGo/pc-site-backend" -ForegroundColor Cyan
    } else {
        Write-Host "`n❌ 푸시 실패. 인증이 필요할 수 있습니다." -ForegroundColor Red
        Write-Host "다음 중 하나를 확인하세요:" -ForegroundColor Yellow
        Write-Host "1. GitHub Personal Access Token 설정" -ForegroundColor Yellow
        Write-Host "2. SSH 키 설정" -ForegroundColor Yellow
        Write-Host "3. GitHub CLI 사용 (gh auth login)" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n❌ 취소되었습니다." -ForegroundColor Red
    Write-Host "수동으로 푸시하려면 다음 명령어를 실행하세요:" -ForegroundColor Yellow
    Write-Host "git push -f origin main" -ForegroundColor Cyan
}

