export const karmaTemplate = {
    english: `Generate a commit message following the Karma format:
<type>(<scope>): <message>

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation change
- style: Formatting, missing semi colons, etc
- refactor: Code refactoring
- test: Adding tests
- chore: Maintenance

Example:
chore(ci): update deployment script to Node 16`,

    russian: `Создайте сообщение коммита в формате Karma:
<тип>(<область>): <сообщение>

Типы:
- feat: Новая функциональность
- fix: Исправление ошибки
- docs: Изменения в документации
- style: Форматирование, пропущенные точки с запятой и т.д.
- refactor: Рефакторинг кода
- test: Добавление тестов
- chore: Обслуживание

Пример:
chore(ci): обновить скрипт деплоя до Node 16`,

    chinese: `生成符合 Karma 格式的提交信息：
<类型>(<范围>): <信息>

类型：
- feat: 新功能
- fix: Bug 修复
- docs: 文档更改
- style: 格式化、缺少分号等
- refactor: 代码重构
- test: 添加测试
- chore: 维护

示例：
chore(ci): 更新部署脚本至 Node 16`,

    japanese: `Karma形式のコミットメッセージを生成してください：
<タイプ>(<スコープ>): <メッセージ>

タイプ：
- feat: 新機能
- fix: バグ修正
- docs: ドキュメント変更
- style: フォーマット、セミコロンの欠落など
- refactor: コードリファクタリング
- test: テストの追加
- chore: メンテナンス

例：
chore(ci): デプロイスクリプトをNode 16に更新`,

    german: `Erstellen Sie eine Commit-Nachricht im Karma-Format:
<Typ>(<Bereich>): <Nachricht>

Typen:
- feat: Neue Funktion
- fix: Fehlerbehebung
- docs: Dokumentationsänderung
- style: Formatierung, fehlende Semikolons usw.
- refactor: Code-Refactoring
- test: Tests hinzufügen
- chore: Wartung

Beispiel:
chore(ci): Deployment-Skript auf Node 16 aktualisieren`,

    french: `Générez un message de commit au format Karma :
<type>(<portée>): <message>

Types :
- feat: Nouvelle fonctionnalité
- fix: Correction de bug
- docs: Modification de documentation
- style: Formatage, points-virgules manquants, etc.
- refactor: Refactorisation de code
- test: Ajout de tests
- chore: Maintenance

Exemple :
chore(ci): mettre à jour le script de déploiement vers Node 16`,

    korean: `Karma 형식에 따라 커밋 메시지를 생성하세요:
<타입>(<범위>): <메시지>

타입:
- feat: 새 기능
- fix: 버그 수정
- docs: 문서 변경
- style: 포맷팅, 세미콜론 누락 등
- refactor: 코드 리팩토링
- test: 테스트 추가
- chore: 유지보수

예시:
chore(ci): 배포 스크립트를 Node 16으로 업데이트`,

    spanish: `Genera un mensaje de commit siguiendo el formato Karma:
<tipo>(<ámbito>): <mensaje>

Tipos:
- feat: Nueva característica
- fix: Corrección de bug
- docs: Cambio en documentación
- style: Formato, punto y coma faltantes, etc
- refactor: Refactorización de código
- test: Añadir pruebas
- chore: Mantenimiento

Ejemplo:
chore(ci): actualizar script de despliegue a Node 16`,

    portuguese: `Gere uma mensagem de commit seguindo o formato Karma:
<tipo>(<escopo>): <mensagem>

Tipos:
- feat: Nova funcionalidade
- fix: Correção de bug
- docs: Alteração na documentação
- style: Formatação, ponto e vírgula, etc.
- refactor: Refatoração de código
- test: Adição de testes
- chore: Manutenção

Exemplo:
chore(ci): atualizar script de deploy para Node 16`,
};