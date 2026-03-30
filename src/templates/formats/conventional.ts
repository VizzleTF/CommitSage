export const conventionalTemplate = {
    english: `Generate a commit message following the Conventional Commits format:
<type>[optional scope]: <description>

[optional body with bullet points]

Rules:
1. First line: type(scope): description (max 50 chars)
2. For small changes use only first line
3. For complex changes list key points in body:
   - Each line starts with "- "
   - Each line max 50 chars
   - Limit to 5 bullet points
   - Summarize changes concisely

Type selection rules:
- docs: ANY changes to documentation files (*.md, docs/*)
- feat: New features or significant functional changes
- fix: Bug fixes and error corrections
- style: Formatting, semicolons, etc (no code change)
- refactor: Code changes that don't fix bugs or add features
- perf: Performance improvements
- test: Adding or updating tests
- build: Build system or dependencies
- ci: CI/CD changes
- chore: Other maintenance tasks

Examples:
Documentation change:
docs: update installation and usage guides

- Added new features description
- Updated configuration section
- Added usage examples

Feature change:
feat(auth): add user authentication

- Implemented OAuth2 provider integration
- Created auth service module
- Added session management`,

    russian: `Создайте сообщение коммита в формате Conventional Commits:
<тип>[опциональная область]: <описание>

[опциональное тело со списком изменений]

Правила:
1. Первая строка: тип(область): описание (макс 50 символов)
2. Для небольших изменений только первая строка
3. Для сложных изменений список ключевых моментов:
   - Каждая строка начинается с "- "
   - Каждая строка макс 50 символов
   - Ограничить 5 пунктами
   - Кратко резюмировать изменения

Правила выбора типа:
- docs: ЛЮБЫЕ изменения в документации (*.md, docs/*)
- feat: Новая функциональность или значимые изменения
- fix: Исправление ошибок
- style: Форматирование, точки с запятой и т.д.
- refactor: Изменения кода без новой функциональности
- perf: Улучшения производительности
- test: Добавление или обновление тестов
- build: Система сборки или зависимости
- ci: Изменения в CI/CD
- chore: Другие задачи обслуживания

Примеры:
Изменение документации:
docs: обновить руководство по установке и использованию

- Добавлено описание новых функций
- Обновлен раздел конфигурации
- Добавлены примеры использования

Новая функциональность:
feat(auth): добавить аутентификацию пользователей

- Внедрена интеграция с OAuth2
- Создан модуль сервиса авторизации
- Добавлено управление сессиями`,

    chinese: `生成符合约定式提交（Conventional Commits）格式的提交信息：
<类型>[可选范围]: <描述>

[可选正文，包含要点]

规则：
1. 第一行：类型(范围): 描述（最多50个字符）
2. 对于小改动，仅使用第一行
3. 对于复杂改动，在正文中列出关键点：
   - 每行以"- "开头
   - 每行最多50个字符
   - 限制为5个要点
   - 简明扼要地总结更改

类型选择规则：
- docs: 对文档文件的任何修改（*.md, docs/*）
- feat: 新功能或重要的功能变更
- fix: Bug修复和错误更正
- style: 格式修改，如分号等（无代码变动）
- refactor: 不修复bug或添加功能的代码修改
- perf: 性能提升
- test: 添加或更新测试
- build: 构建系统或依赖项
- ci: CI/CD的变动
- chore: 其他维护任务

示例：
文档修改：
docs: 更新安装和使用指南

- 添加新功能描述
- 更新配置部分
- 增加使用示例

功能更改：
feat(auth): 添加用户认证

- 实现OAuth2提供者集成
- 创建身份验证服务模块
- 添加会话管理`,

    japanese: `コミットメッセージを Conventional Commits 形式で生成してください：
<タイプ>[オプションのスコープ]: <説明>

[オプションの本文（箇条書き）]

ルール：
1. 1行目: タイプ(スコープ): 説明 (最大50文字)
2. 小さな変更は1行目のみ
3. 複雑な変更は本文に要点を列挙：
   - 各行は "- " で始まる
   - 各行最大50文字
   - 5つの箇条書きに制限
   - 変更を簡潔に要約

タイプの選択ルール：
- docs: ドキュメントの変更 (*.md, docs/*)
- feat: 新機能または重要な機能変更
- fix: バグ修正とエラー訂正
- style: フォーマット、セミコロンなど（コード変更なし）
- refactor: バグ修正や機能追加を伴わないコード変更
- perf: パフォーマンスの改善
- test: テストの追加または更新
- build: ビルドシステムまたは依存関係の変更
- ci: CI/CDの変更
- chore: その他のメンテナンスタスク

例：
ドキュメントの変更：
docs: インストールと使用方法のガイドを更新

- 新機能の説明を追加
- 設定セクションを更新
- 使用例を追加

機能の変更：
feat(auth): ユーザー認証を追加

- OAuth2プロバイダーの統合を実装
- 認証サービスモジュールを作成
- セッション管理を追加`,

    german: `Erstellen Sie eine Commit-Nachricht im Conventional Commits-Format:
<Typ>[optionaler Bereich]: <Beschreibung>

[optionaler Textkörper mit Aufzählungspunkten]

Regeln:
1. Erste Zeile: Typ(Bereich): Beschreibung (max. 50 Zeichen)
2. Bei kleinen Änderungen nur die erste Zeile verwenden
3. Bei komplexen Änderungen Kernpunkte im Textkörper auflisten:
   - Jede Zeile beginnt mit "- "
   - Jede Zeile max. 50 Zeichen
   - Auf 5 Aufzählungspunkte begrenzen
   - Änderungen prägnant zusammenfassen

Regeln zur Typauswahl:
- docs: ALLE Änderungen an Dokumentationsdateien (*.md, docs/*)
- feat: Neue Funktionen oder bedeutende funktionale Änderungen
- fix: Fehlerbehebungen und Korrekturen
- style: Formatierung, Semikolons usw. (keine Codeänderung)
- refactor: Codeänderungen ohne Fehlerbehebung oder neue Funktionen
- perf: Leistungsverbesserungen
- test: Tests hinzufügen oder aktualisieren
- build: Build-System oder Abhängigkeiten
- ci: CI/CD-Änderungen
- chore: Sonstige Wartungsaufgaben

Beispiele:
Dokumentationsänderung:
docs: Installations- und Nutzungsanleitungen aktualisieren

- Beschreibung neuer Funktionen hinzugefügt
- Konfigurationsabschnitt aktualisiert
- Nutzungsbeispiele hinzugefügt

Funktionsänderung:
feat(auth): Benutzerauthentifizierung hinzufügen

- OAuth2-Provider-Integration implementiert
- Auth-Service-Modul erstellt
- Sitzungsverwaltung hinzugefügt`,

    french: `Générez un message de commit au format Conventional Commits :
<type>[portée optionnelle]: <description>

[corps optionnel avec liste à puces]

Règles :
1. Première ligne : type(portée): description (max 50 caractères)
2. Pour les petits changements, utiliser uniquement la première ligne
3. Pour les changements complexes, lister les points clés dans le corps :
   - Chaque ligne commence par "- "
   - Chaque ligne max 50 caractères
   - Limiter à 5 puces
   - Résumer les changements de manière concise

Règles de sélection du type :
- docs : TOUT changement dans les fichiers de documentation (*.md, docs/*)
- feat : Nouvelles fonctionnalités ou changements fonctionnels significatifs
- fix : Corrections de bugs et d'erreurs
- style : Formatage, points-virgules, etc. (pas de changement de code)
- refactor : Changements de code sans correction de bug ni ajout de fonctionnalité
- perf : Améliorations des performances
- test : Ajout ou mise à jour de tests
- build : Système de build ou dépendances
- ci : Changements CI/CD
- chore : Autres tâches de maintenance

Exemples :
Changement de documentation :
docs: mettre à jour les guides d'installation et d'utilisation

- Ajout de la description des nouvelles fonctionnalités
- Mise à jour de la section configuration
- Ajout d'exemples d'utilisation

Changement de fonctionnalité :
feat(auth): ajouter l'authentification utilisateur

- Intégration du fournisseur OAuth2 implémentée
- Module de service d'authentification créé
- Gestion des sessions ajoutée`,

    korean: `Conventional Commits 형식에 따라 커밋 메시지를 생성하세요:
<타입>[선택적 범위]: <설명>

[선택적 본문 (글머리 기호)]

규칙:
1. 첫 번째 줄: 타입(범위): 설명 (최대 50자)
2. 작은 변경은 첫 번째 줄만 사용
3. 복잡한 변경은 본문에 핵심 사항을 나열:
   - 각 줄은 "- "로 시작
   - 각 줄 최대 50자
   - 5개 항목으로 제한
   - 변경 사항을 간결하게 요약

타입 선택 규칙:
- docs: 문서 파일의 모든 변경 (*.md, docs/*)
- feat: 새로운 기능 또는 중요한 기능 변경
- fix: 버그 수정 및 오류 수정
- style: 포맷팅, 세미콜론 등 (코드 변경 없음)
- refactor: 버그 수정이나 기능 추가 없는 코드 변경
- perf: 성능 개선
- test: 테스트 추가 또는 업데이트
- build: 빌드 시스템 또는 종속성
- ci: CI/CD 변경
- chore: 기타 유지보수 작업

예시:
문서 변경:
docs: 설치 및 사용 가이드 업데이트

- 새로운 기능 설명 추가
- 설정 섹션 업데이트
- 사용 예시 추가

기능 변경:
feat(auth): 사용자 인증 추가

- OAuth2 제공자 통합 구현
- 인증 서비스 모듈 생성
- 세션 관리 추가`,

    spanish: `Genera un mensaje de commit siguiendo el formato de Conventional Commits:
<tipo>[ámbito opcional]: <descripción>

[cuerpo opcional con puntos]

Reglas:
1. Primera línea: tipo(ámbito): descripción (máx 50 caracteres)
2. Para cambios pequeños usar solo la primera línea
3. Para cambios complejos listar puntos clave en el cuerpo:
   - Cada línea empieza con "- "
   - Cada línea máx 50 caracteres
   - Limitar a 5 puntos
   - Resumir cambios de forma concisa

Reglas de selección de tipo:
- docs: CUALQUIER cambio en documentación (*.md, docs/*)
- feat: Nuevas características o cambios funcionales significativos
- fix: Correcciones de errores y bugs
- style: Formato, punto y coma, etc (sin cambios de código)
- refactor: Cambios de código que no arreglan bugs ni añaden funciones
- perf: Mejoras de rendimiento
- test: Añadir o actualizar pruebas
- build: Sistema de build o dependencias
- ci: Cambios en CI/CD
- chore: Otras tareas de mantenimiento

Ejemplos:
Cambio en documentación:
docs: actualizar guías de instalación y uso

- Añadida descripción de nuevas características
- Actualizada sección de configuración
- Añadidos ejemplos de uso

Cambio de característica:
feat(auth): añadir autenticación de usuario

- Implementada integración con proveedor OAuth2
- Creado módulo de servicio de autenticación
- Añadida gestión de sesiones`,

    portuguese: `Gere uma mensagem de commit no formato Conventional Commits:
<tipo>[escopo opcional]: <descrição>

[corpo opcional com tópicos]

Regras:
1. Primeira linha: tipo(escopo): descrição (máx 50 chars)
2. Para mudanças pequenas, use apenas a primeira linha
3. Para mudanças complexas, liste pontos-chave no corpo:
   - Cada linha começa com "- "
   - Cada linha com no máximo 50 caracteres
   - Limite de 5 tópicos
   - Resuma as mudanças de forma concisa

Regras de seleção de tipo:
- docs: QUALQUER mudança em arquivos de documentação (*.md, docs/*)
- feat: Novas funcionalidades ou mudanças funcionais significativas
- fix: Correções de bugs e erros
- style: Formatação, ponto e vírgula, etc (sem mudança de código)
- refactor: Mudanças de código que não corrigem bugs nem add funções
- perf: Melhorias de desempenho
- test: Adição ou atualização de testes
- build: Sistema de build ou dependências
- ci: Mudanças de CI/CD
- chore: Outras tarefas de manutenção

Exemplos:
Mudança de documentação:
docs: atualizar guias de instalação e uso

- Adicionada descrição de novos recursos
- Atualizada seção de configuração
- Adicionados exemplos de uso

Mudança de funcionalidade:
feat(auth): adicionar autenticação de usuário

- Implementada integração com provedor OAuth2
- Criado módulo de serviço de autenticação
- Adicionado gerenciamento de sessões`,
};
