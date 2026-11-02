#!/bin/zsh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 20 이상을 설치해 주세요: https://nodejs.org/'
  read 'REPLY?엔터를 눌러 종료합니다.'
  exit 1
fi
open 'http://localhost:3000'
node server.js
