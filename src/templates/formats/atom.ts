export const atomTemplate = {
    english: `Generate a commit message following the Atom format:
<type>(<scope>): <subject>

<body>

<footer>

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

Scope (optional): The part of the codebase affected (e.g., auth, ui, api, core)

Example:
feat(auth): add OAuth2 integration with Google provider

Implemented complete OAuth2 flow including:
- Authorization code exchange
- Token refresh mechanism
- User profile retrieval
- Session management

Tested with multiple user scenarios and edge cases.
Added comprehensive error handling for network failures.

Closes #123
Breaking-change: Updated auth API endpoints`,

    russian: `Создайте сообщение коммита в формате Atom:
<тип>(<область>): <тема>

<тело>

<подвал>

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

Область (опционально): Часть кодовой базы, которая затронута (например, auth, ui, api, core)

Пример:
feat(auth): добавить интеграцию OAuth2 с провайдером Google

Реализован полный поток OAuth2, включающий:
- Обмен кода авторизации
- Механизм обновления токенов
- Получение профиля пользователя
- Управление сессиями

Протестировано с множественными пользовательскими сценариями и граничными случаями.
Добавлена комплексная обработка ошибок для сетевых сбоев.

Закрывает #123
Критическое изменение: Обновлены конечные точки API аутентификации`,

    chinese: `生成符合 Atom 格式的提交信息：
<类型>(<范围>): <主题>

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

范围（可选）：受影响的代码库部分（例如：auth、ui、api、core）

示例：
feat(auth): 添加与 Google 提供商的 OAuth2 集成

实现了完整的 OAuth2 流程，包括：
- 授权码交换
- 令牌刷新机制
- 用户配置文件检索
- 会话管理

使用多种用户场景和边缘情况进行测试。
为网络故障添加了全面的错误处理。

关闭 #123
破坏性更改：更新了认证 API 端点`,

    japanese: `Atom形式のコミットメッセージを生成してください：
<タイプ>(<スコープ>): <件名>

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

スコープ（オプション）：影響を受けるコードベースの部分（例：auth、ui、api、core）

例：
feat(auth): GoogleプロバイダーとのOAuth2統合を追加

以下を含む完全なOAuth2フローを実装：
- 認証コード交換
- トークンリフレッシュメカニズム
- ユーザープロファイル取得
- セッション管理

複数のユーザーシナリオとエッジケースでテスト済み。
ネットワーク障害に対する包括的なエラーハンドリングを追加。

#123を閉じる
破壊的変更：認証APIエンドポイントを更新`,

    german: `Erstellen Sie eine Commit-Nachricht im Atom-Format:
<Typ>(<Bereich>): <Betreff>

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

Bereich (optional): Der betroffene Teil der Codebasis (z.B. auth, ui, api, core)

Beispiel:
feat(auth): OAuth2-Integration mit Google-Provider hinzufügen

Vollständigen OAuth2-Flow implementiert, einschließlich:
- Autorisierungscode-Austausch
- Token-Aktualisierungsmechanismus
- Benutzerprofil-Abruf
- Sitzungsverwaltung

Mit mehreren Benutzerszenarien und Grenzfällen getestet.
Umfassende Fehlerbehandlung für Netzwerkausfälle hinzugefügt.

Closes #123
Breaking-change: Auth-API-Endpunkte aktualisiert`,

    french: `Générez un message de commit au format Atom :
<type>(<portée>): <sujet>

<corps>

<pied de page>

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

Portée (optionnel) : La partie du code concernée (ex : auth, ui, api, core)

Exemple :
feat(auth): ajouter l'intégration OAuth2 avec le fournisseur Google

Flux OAuth2 complet implémenté, incluant :
- Échange de code d'autorisation
- Mécanisme de rafraîchissement des jetons
- Récupération du profil utilisateur
- Gestion des sessions

Testé avec plusieurs scénarios utilisateur et cas limites.
Gestion complète des erreurs pour les pannes réseau ajoutée.

Closes #123
Breaking-change: Endpoints API d'authentification mis à jour`,

    korean: `Atom 형식에 따라 커밋 메시지를 생성하세요:
<타입>(<범위>): <제목>

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

범위 (선택): 영향을 받는 코드베이스 부분 (예: auth, ui, api, core)

예시:
feat(auth): Google 제공자와 OAuth2 통합 추가

다음을 포함한 전체 OAuth2 흐름을 구현:
- 인증 코드 교환
- 토큰 갱신 메커니즘
- 사용자 프로필 조회
- 세션 관리

여러 사용자 시나리오와 엣지 케이스로 테스트 완료.
네트워크 장애에 대한 포괄적인 오류 처리 추가.

Closes #123
Breaking-change: 인증 API 엔드포인트 업데이트`,

    spanish: `Genera un mensaje de commit siguiendo el formato Atom:
<tipo>(<ámbito>): <asunto>

<cuerpo>

<pie>

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

Ámbito (opcional): La parte del código base afectada (ej: auth, ui, api, core)

Ejemplo:
feat(auth): añadir integración OAuth2 con proveedor Google

Implementado flujo OAuth2 completo incluyendo:
- Intercambio de código de autorización
- Mecanismo de actualización de tokens
- Recuperación de perfil de usuario
- Gestión de sesiones

Probado con múltiples escenarios de usuario y casos límite.
Añadido manejo integral de errores para fallos de red.

Cierra #123
Cambio disruptivo: Actualizados endpoints de API de autenticación`,

    portuguese: `Gere uma mensagem de commit seguindo o formato Atom:
<tipo>(<escopo>): <assunto>

<corpo>

<rodapé>

Tipos:
- feat: Nova funcionalidade
- fix: Correção de erro
- docs: Alterações na documentação
- style: Alterações no estilo do código (formatação, ponto e vírgula, etc.)
- refactor: Refatoração de código
- test: Adição ou modificação de testes
- chore: Tarefas de manutenção
- perf: Melhorias de desempenho
- ci: Alterações de CI/CD
- build: Alterações no sistema de build
- revert: Reverter commit anterior

Escopo (opcional): A parte do código afetada (ex: auth, ui, api, core)

Exemplo:
feat(auth): adicionar integração OAuth2 com provedor Google

Implementado o fluxo OAuth2 completo, incluindo:
- Troca de código de autorização
- Mecanismo de renovação de token (refresh)
- Recuperação de perfil de usuário
- Gerenciamento de sessão

Testado com múltiplos cenários de usuário e casos de borda.
Adicionado tratamento de erros abrangente para falhas de rede.

Fecha #123
Mudança quebra-padrão: Atualizados os endpoints da API de autenticação`,
};