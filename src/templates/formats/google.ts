export const googleTemplate = {
    english: `Generate a commit message following the Google format:
<Type>: <Description>

<Body>

<Footer>

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation changes
- style: Code style changes (formatting, missing semicolons, etc.)
- refactor: Code refactoring
- test: Adding or modifying tests
- chore: Maintenance tasks
- perf: Performance improvements
- ci: CI/CD changes
- build: Build system changes
- revert: Revert previous commit

Example:
feat: Add user authentication system

Implemented OAuth2 integration with Google and GitHub providers.
Added JWT token management and refresh mechanism.
Included comprehensive test coverage for auth flows.

Closes #123
Reviewed-by: @teammate`,

    russian: `Создайте сообщение коммита в формате Google:
<Тип>: <Описание>

<Тело>

<Подвал>

Типы:
- feat: Новая функциональность
- fix: Исправление ошибок
- docs: Изменения в документации
- style: Изменения стиля кода (форматирование, пропущенные точки с запятой и т.д.)
- refactor: Рефакторинг кода
- test: Добавление или изменение тестов
- chore: Вспомогательные задачи
- perf: Улучшения производительности
- ci: Изменения CI/CD
- build: Изменения системы сборки
- revert: Откат предыдущего коммита

Пример:
feat: Добавить систему аутентификации пользователей

Реализована интеграция OAuth2 с провайдерами Google и GitHub.
Добавлено управление JWT токенами и механизм обновления.
Включено полное покрытие тестами для потоков аутентификации.

Закрывает #123
Проверено: @teammate`,

    chinese: `生成符合 Google 格式的提交信息：
<类型>: <描述>

<正文>

<页脚>

类型：
- feat: 新功能
- fix: Bug 修复
- docs: 文档更改
- style: 代码样式更改（格式化、缺少分号等）
- refactor: 代码重构
- test: 添加或修改测试
- chore: 维护任务
- perf: 性能改进
- ci: CI/CD 更改
- build: 构建系统更改
- revert: 撤销之前的提交

示例：
feat: 添加用户认证系统

实现了与 Google 和 GitHub 提供商的 OAuth2 集成。
添加了 JWT 令牌管理和刷新机制。
包含了认证流程的全面测试覆盖。

关闭 #123
审查者：@teammate`,

    japanese: `Google形式のコミットメッセージを生成してください：
<タイプ>: <説明>

<本文>

<フッター>

タイプ：
- feat: 新機能
- fix: バグ修正
- docs: ドキュメント変更
- style: コードスタイル変更（フォーマット、セミコロンの欠落など）
- refactor: コードリファクタリング
- test: テストの追加・修正
- chore: メンテナンスタスク
- perf: パフォーマンス改善
- ci: CI/CD変更
- build: ビルドシステム変更
- revert: 前のコミットを元に戻す

例：
feat: ユーザー認証システムを追加

GoogleとGitHubプロバイダーとのOAuth2統合を実装。
JWTトークン管理とリフレッシュメカニズムを追加。
認証フローの包括的なテストカバレッジを含む。

#123を閉じる
レビュー者：@teammate`,

    german: `Erstellen Sie eine Commit-Nachricht im Google-Format:
<Typ>: <Beschreibung>

<Textkörper>

<Fußzeile>

Typen:
- feat: Neue Funktion
- fix: Fehlerbehebung
- docs: Dokumentationsänderungen
- style: Codestil-Änderungen (Formatierung, fehlende Semikolons usw.)
- refactor: Code-Refactoring
- test: Tests hinzufügen oder ändern
- chore: Wartungsaufgaben
- perf: Leistungsverbesserungen
- ci: CI/CD-Änderungen
- build: Build-System-Änderungen
- revert: Vorherigen Commit rückgängig machen

Beispiel:
feat: Benutzerauthentifizierungssystem hinzufügen

OAuth2-Integration mit Google- und GitHub-Providern implementiert.
JWT-Token-Verwaltung und Aktualisierungsmechanismus hinzugefügt.
Umfassende Testabdeckung für Auth-Flows eingebunden.

Closes #123
Reviewed-by: @teammate`,

    french: `Générez un message de commit au format Google :
<Type>: <Description>

<Corps>

<Pied de page>

Types :
- feat: Nouvelle fonctionnalité
- fix: Correction de bug
- docs: Modifications de documentation
- style: Changements de style de code (formatage, points-virgules manquants, etc.)
- refactor: Refactorisation de code
- test: Ajout ou modification de tests
- chore: Tâches de maintenance
- perf: Améliorations des performances
- ci: Changements CI/CD
- build: Changements du système de build
- revert: Annuler un commit précédent

Exemple :
feat: Ajouter le système d'authentification utilisateur

Intégration OAuth2 avec les fournisseurs Google et GitHub implémentée.
Gestion des jetons JWT et mécanisme de rafraîchissement ajoutés.
Couverture de tests complète pour les flux d'authentification incluse.

Closes #123
Reviewed-by: @teammate`,

    korean: `Google 형식에 따라 커밋 메시지를 생성하세요:
<타입>: <설명>

<본문>

<꼬리말>

타입:
- feat: 새 기능
- fix: 버그 수정
- docs: 문서 변경
- style: 코드 스타일 변경 (포맷팅, 세미콜론 누락 등)
- refactor: 코드 리팩토링
- test: 테스트 추가 또는 수정
- chore: 유지보수 작업
- perf: 성능 개선
- ci: CI/CD 변경
- build: 빌드 시스템 변경
- revert: 이전 커밋 되돌리기

예시:
feat: 사용자 인증 시스템 추가

Google 및 GitHub 제공자와 OAuth2 통합을 구현했습니다.
JWT 토큰 관리 및 갱신 메커니즘을 추가했습니다.
인증 흐름에 대한 포괄적인 테스트 커버리지를 포함했습니다.

Closes #123
Reviewed-by: @teammate`,

    spanish: `Genera un mensaje de commit siguiendo el formato Google:
<Tipo>: <Descripción>

<Cuerpo>

<Pie>

Tipos:
- feat: Nueva característica
- fix: Corrección de errores
- docs: Cambios en documentación
- style: Cambios de estilo de código (formato, punto y coma faltantes, etc.)
- refactor: Refactorización de código
- test: Añadir o modificar pruebas
- chore: Tareas de mantenimiento
- perf: Mejoras de rendimiento
- ci: Cambios de CI/CD
- build: Cambios del sistema de construcción
- revert: Revertir commit anterior

Ejemplo:
feat: Añadir sistema de autenticación de usuario

Implementada integración OAuth2 con proveedores Google y GitHub.
Añadida gestión de tokens JWT y mecanismo de actualización.
Incluida cobertura completa de pruebas para flujos de autenticación.

Cierra #123
Revisado por: @teammate`,

    portuguese: `Gere uma mensagem de commit seguindo o formato Google:
<Tipo>: <Descrição>

<Corpo>

<Rodapé>

Tipos:
- feat: Nova funcionalidade
- fix: Correção de bug
- docs: Alterações na documentação
- style: Alterações no estilo do código (formatação, ponto e vírgula, etc.)
- refactor: Refatoração de código
- test: Adição ou modificação de testes
- chore: Tarefas de manutenção
- perf: Melhorias de desempenho
- ci: Alterações de CI/CD
- build: Alterações no sistema de build
- revert: Reverter commit anterior

Exemplo:
feat: Adicionar sistema de autenticação de usuário

Implementada integração OAuth2 com provedores Google e GitHub.
Adicionado gerenciamento de tokens JWT e mecanismo de atualização.
Incluída cobertura de testes abrangente para os fluxos de autenticação.

Fecha #123
Revisado por: @teammate`,
};