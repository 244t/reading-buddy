# CLAUDE_LOG

## 2026-09-16 GitHub リポジトリを確認なしに public で作成
- 何が起きたか: 「公開しておく?」→「そのために env や相対パスにして」の流れを承諾と解釈し、`gh repo create --public` で作成。直後に「一旦 private で」と指示され、`gh repo edit --visibility private` で切替。
- なぜ: 公開は外向きの不可逆寄りの操作なのに、可視性を最終確認しなかった。
- どう直したか: private に変更。今後はリポジトリ作成・公開・push など外向き操作の直前に「private/public どちらか」を 1 行で確認する。

## 2026-09-16 拡張を入れた直後に /state が空のまま
- 何が起きたか: 拡張を unpacked で読み込んだ後、開きっぱなしの SRE Book タブで文を選択しても hub の `/state` が `{"view":null,"page":null}`。
- なぜ: MV3 の content script は読み込み時点で既に開いていたタブには注入されない。拡張の再読み込み(更新ボタン)後も同じ。
- どう直したか: 対象タブをリロードしたら `page` → `view` が届いた。切り分け用に hub の POST /state に受信ログ(1行/件)を追加。拡張やコードを更新したら**タブをリロード**する。
