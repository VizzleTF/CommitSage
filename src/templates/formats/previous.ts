// The `previous` format has no fixed structure: the repository's recent commit
// messages (injected after this template by promptService) ARE the style spec.
// This template is just the lead instruction telling the model to mimic them.
export const previousTemplate = {
    english: `Generate a commit message that matches the style, tone, structure, and conventions of this repository's recent commit messages shown below. Infer the format (type prefixes, scope, capitalization, body style) from those examples.`,
    russian: `Создайте сообщение коммита, повторяющее стиль, тон, структуру и соглашения недавних коммитов этого репозитория (показаны ниже). Определите формат (префиксы типа, область, регистр, стиль тела) по этим примерам.`,
    chinese: `生成一条提交信息，匹配本仓库下方所示近期提交信息的风格、语气、结构和约定。请从这些示例中推断格式（类型前缀、范围、大小写、正文风格）。`,
    japanese: `以下に示すこのリポジトリの最近のコミットメッセージのスタイル、トーン、構造、規約に合わせてコミットメッセージを生成してください。これらの例から形式（タイプ接頭辞、スコープ、大文字小文字、本文スタイル）を推測してください。`,
    german: `Erstellen Sie eine Commit-Nachricht, die dem Stil, Ton, der Struktur und den Konventionen der unten gezeigten letzten Commit-Nachrichten dieses Repositorys entspricht. Leiten Sie das Format (Typ-Präfixe, Bereich, Groß-/Kleinschreibung, Textstil) aus diesen Beispielen ab.`,
    french: `Générez un message de commit qui correspond au style, au ton, à la structure et aux conventions des messages de commit récents de ce dépôt présentés ci-dessous. Déduisez le format (préfixes de type, portée, casse, style du corps) à partir de ces exemples.`,
    korean: `아래에 표시된 이 저장소의 최근 커밋 메시지의 스타일, 어조, 구조 및 관례에 맞는 커밋 메시지를 생성하세요. 이러한 예시에서 형식(타입 접두사, 범위, 대소문자, 본문 스타일)을 추론하세요.`,
    spanish: `Genera un mensaje de commit que coincida con el estilo, tono, estructura y convenciones de los mensajes de commit recientes de este repositorio que se muestran a continuación. Deduce el formato (prefijos de tipo, ámbito, mayúsculas, estilo del cuerpo) a partir de esos ejemplos.`,
    portuguese: `Gere uma mensagem de commit que corresponda ao estilo, tom, estrutura e convenções das mensagens de commit recentes deste repositório mostradas abaixo. Deduza o formato (prefixos de tipo, escopo, capitalização, estilo do corpo) a partir desses exemplos.`,
};
