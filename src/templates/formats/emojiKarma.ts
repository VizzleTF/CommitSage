import { EMOJI_LIST } from './emoji';
import { KARMA_TYPES } from './karma';

export const emojiKarmaTemplate = {
    english: `Generate a commit message following the Emoji-Karma format:
:emoji: type(scope): message

${KARMA_TYPES.english}

${EMOJI_LIST.english}

Example:
✨ feat(auth): add user authentication system
🐛 fix(api): resolve token expiration issue`,

    russian: `Создайте сообщение коммита в формате Emoji-Karma:
:emoji: тип(область): сообщение

${KARMA_TYPES.russian}

${EMOJI_LIST.russian}

Пример:
✨ feat(auth): добавить систему аутентификации пользователей
🐛 fix(api): исправить проблему истечения срока токена`,

    chinese: `生成符合 Emoji-Karma 格式的提交信息：
:emoji: 类型(范围): 信息

${KARMA_TYPES.chinese}

${EMOJI_LIST.chinese}

示例：
✨ feat(auth): 添加用户认证系统
🐛 fix(api): 解决令牌过期问题`,

    japanese: `絵文字とKarma形式を組み合わせたコミットメッセージを生成してください：
:emoji: タイプ(スコープ): メッセージ

${KARMA_TYPES.japanese}

${EMOJI_LIST.japanese}

例：
✨ feat(auth): ユーザー認証システムを追加
🐛 fix(api): トークン期限切れの問題を解決`,

    german: `Erstellen Sie eine Commit-Nachricht im Emoji-Karma-Format:
:emoji: Typ(Bereich): Nachricht

${KARMA_TYPES.german}

${EMOJI_LIST.german}

Beispiele:
✨ feat(auth): Benutzerauthentifizierungssystem hinzufügen
🐛 fix(api): Token-Ablaufproblem beheben`,

    french: `Générez un message de commit au format Emoji-Karma :
:emoji: type(portée): message

${KARMA_TYPES.french}

${EMOJI_LIST.french}

Exemples :
✨ feat(auth): ajouter le système d'authentification utilisateur
🐛 fix(api): résoudre le problème d'expiration du jeton`,

    korean: `Emoji-Karma 형식에 따라 커밋 메시지를 생성하세요:
:emoji: 타입(범위): 메시지

${KARMA_TYPES.korean}

${EMOJI_LIST.korean}

예시:
✨ feat(auth): 사용자 인증 시스템 추가
🐛 fix(api): 토큰 만료 문제 해결`,

    spanish: `Genera un mensaje de commit siguiendo el formato Emoji-Karma:
:emoji: tipo(ámbito): mensaje

${KARMA_TYPES.spanish}

${EMOJI_LIST.spanish}

Ejemplo:
✨ feat(auth): añadir sistema de autenticación de usuario
🐛 fix(api): resolver problema de expiración del token`,

    portuguese: `Gere uma mensagem de commit seguindo o formato Emoji-Karma:
:emoji: tipo(escopo): mensagem

${KARMA_TYPES.portuguese}

${EMOJI_LIST.portuguese}

Exemplo:
✨ feat(auth): adicionar sistema de autenticação de usuário
🐛 fix(api): resolver problema de expiração de token`,
};
