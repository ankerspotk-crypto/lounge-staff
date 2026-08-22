/**
 * manual.gs — 黒服 新人マニュアル（軍師で読む・コンソールで直す）
 *
 *  ボス確定(2026-08-22):
 *   ① 対象＝黒服の新人だけ。置き場所は軍師（黒服iPad）のみ。キャスト向けは作らない。
 *   ② 本文の正本＝スプレッドシートの「マニュアル」タブ。コンソール(Admin)から章・項目を編集できる。
 *   ③ スキルテストはこのマニュアルの章に紐づける（テスト＝マニュアルからの抜き取り）。
 *
 *  ⚠️初期本文は「店の実データ」から起こしている。でっち上げ厳禁。出典＝
 *    ・CHECKLIST_DEFAULTS_ / MSG_KINSEN_MAE（実在の開店前チェック9項目）
 *    ・MSG_SOGANBANSEN / MSG_SEAT_CHECK / MSG_KINSEN_GO / MSG_STAFF_OHAYO / MSG_TAIKIN（実在の定時LINE文面）
 *    ・getNotifSettings_ の配信時刻（店の1日のタイムライン）
 *    ・skilldrafts.gs の「りく確定」回答（2026-07-25にりくが確定させた店の基準）
 *    ・現金4袋・日払い×0.8979・退勤の現金チェックゲート(Code.gs)
 *
 *  依存する既存関数(Code.gs): getOrOpenSS_, isAdmin_, getStaffName, TZ
 *  ⚠️軍師から呼ぶ関数は GUNSHI_API_FNS 登録必須（gunshiGetManual）。漏れると「許可されていない関数」で100%失敗する。
 */

// ============================================================
// シート定義
// ============================================================
var MANUAL_TAB_  = 'マニュアル';
var MANUAL_HEAD_ = ['項目ID', '章', '章順', '節順', '絵文字', 'タイトル', '本文', '重要度', 'タグ', '有効', '更新日時', '更新者'];

// 重要度：''＝通常 ／ '重要'＝強調 ／ '禁止'＝やってはいけない
var MANUAL_LEVELS_ = ['', '重要', '禁止'];

// ============================================================
// 初期本文（シートが空のときだけ投入。以後の正本はシート側）
//   形式: { ch:'章名', emoji:'絵文字', items:[ [タイトル, 本文, 重要度, タグ] ] }
// ============================================================
var MANUAL_DEFAULTS_ = [
  { ch: 'はじめに', emoji: '📖', items: [
    ['この店はどういう店か',
     'ラウンジいえやすは、2フロア（2Fと5F）で営業する会員制のラウンジ。\nご来店いただけるのは会員のお客様と、会員からご紹介いただいたお客様のみ。\n「会員制」は看板ではなく、店の価値そのもの。ここを守るのが黒服の仕事の土台。', '', '店の基本'],
    ['黒服の仕事は「店を回すこと」',
     '席・キャスト・お金・時間の4つを常に把握して、店を止めずに回す。\nお客様を楽しませるのはキャストの仕事。黒服はその舞台を作り、お客様とキャストの両方を守る。', '', '心構え'],
    ['お客様とキャストの情報は絶対に出さない',
     'キャストの連絡先・SNS・個人情報は、本人の同意なく教えない。丁寧にお断りする。\n「今日◯◯さん（他の会員）来てる？」と聞かれても、他のお客様の来店の有無は答えない。\n相手が常連でも会員でも例外はない。', '禁止', '守秘・会員制'],
    ['迷ったら自己判断で通さない',
     '判断に迷ったら、インカムと黒服グループLINEで必ず相談する。\n「聞いてから動く」は遅いのではなく、正しい。自己判断で通した1件が、後から一番大きな事故になる。', '重要', '心構え'],
    ['店の1日（黒服のタイムライン）',
     '18:00 軍師のURLがLINEに届く\n18:30 開店チェック（5F・2Fのレジ現金を入力）\n19:30 開店前チェックの確認\n19:45 外看板・外照明を点灯／スタッフへ朝の挨拶\n20:00 キャスト出勤（20時に席に着ける準備）\n20:30 同伴組・20時半出勤\n22:00 同伴チェック（混雑時は22:30退店の協力依頼）\n22:30 送りサマリー\n23:00 日払い・ドライバー日払いの準備\n23:30 送り確認\n23:45 各席チェックを出し始める\n24:00 閉店（24:20までに全卓チェック終了）\n24:30 完全退店・消灯完了\n00:30 現金チェック（終了）→ 退勤報告', '', 'タイムライン']
  ]},

  { ch: '出勤・身だしなみ', emoji: '👔', items: [
    ['インカムは営業スタートの時につける',
     '出勤してすぐは、まだつけない。営業がスタートする時に装着し、接続を確認する。\n席を移動するたびに、付いているか・聞こえているかを確認する。\nインカム未装着は毎営業のように起きるミス。ホールの連携はここが切れると全部止まる。', '重要', '出勤'],
    ['身だしなみ',
     '清潔なスーツ、磨いた靴、短く整えた爪、整えた髪。\n香水を強くつけない（お客様の席の香りを壊す）。', '', '身だしなみ'],
    ['LINEは必ず見て、必ず返す',
     '黒服グループLINEに来た業務指示は、必ず内容を確認して実行する。\nすぐ動けない時も「後で対応します」と一言返す。\n未読のまま・既読だけで終わらせるのは禁止。', '禁止', 'LINE'],
    ['出勤・退勤の報告',
     'LINEで「出勤しました」「退勤しました」と送ると自動で記録される。\n⚠️退勤報告は、その日の現金チェックに合格していないと受け付けられない（弾かれる）。', '重要', '出勤'],
    ['アフターに行くとき',
     '退勤したスタッフはグループに記載する。\nアフターに行く場合、自分の担当以外のお客様なら、行先と予定時間を担当宛に連絡する。\nアフター終わりでお客様と解散した時も、必ず報告する。', '', 'アフター']
  ]},

  { ch: '開店前', emoji: '🌅', items: [
    ['開店前チェックは軍師から・2Fと5Fの両方',
     '軍師の「👔黒服業務 →🌅開店前」を開き、チェックを進める。\n⚠️2F と 5F それぞれで完了させる。片方だけでは終わっていない。\n未完了があると19:45に項目が再通知される。', '重要', '開店前'],
    ['開店前にやること（9項目）',
     '① 買出し\n② 前日残作業\n③ 運営からの4Sチェックに基づいた作業\n④ おしぼりウォーマーON\n⑤ 納品在庫ノート入力\n⑥ USEN BGMモニターON\n⑦ 店内清掃\n⑧ 手土産準備\n⑨ 予約席セット\n※日払い・ドライバー日払いの準備は23時の作業。', '', '開店前'],
    ['予約席とボトルの準備',
     '予約の入っている席をセットし、担当・会員のボトルを先に出しておく。\n軍師の「🍶本日の予約ボトル」を使うと、棚を一度回るだけで出せる（位置順に並ぶ）。\nお客様が来てから探すのは遅い。', '', '開店前'],
    ['納品が来たら',
     '検品して数量を確認し、納品在庫ノートに入力する。その場で放置しない。', '', '開店前'],
    ['端末の動作確認',
     'クレジット端末（エアペイ等）とTRUSTに、営業前にログインできるか確認する。\nログアウトしたまま営業に入ると、会計でお客様を待たせる。', '重要', '開店前'],
    ['レジ現金の入力（18:30）',
     '軍師の「🌅開店チェック」から、5F・2Fのレジ現金を紙幣別に入力して送信する。\n⚠️送信後は修正できない。必ず数え直してから送る。', '重要', '現金'],
    ['19:45 外看板・外照明を点灯',
     '点け忘れが多い。カメラか目視で本当に点いているのを確認してから、軍師の開店前チェックにチェックを入れる。\n見ずにチェックだけ入れるのが、一番やってはいけない。', '重要', '開店前']
  ]},

  { ch: 'お迎え・受付', emoji: '🚪', items: [
    ['お迎えの基本',
     '笑顔で挨拶し、人数を伺う。無言で席へ通さない。料金の話から入らない。', '', '接客'],
    ['予約のお客様が来店したら',
     '軍師で来店を記録し、席・担当・時間を正しく登録する。\nここを飛ばすと、店の状況（見取り図・付け回し・会計）が全部ずれる。後でまとめて入力しない。', '重要', '軍師'],
    ['担当キャストがすぐ来られない',
     'まずファースト（つなぎ）のキャストをすぐ付け、担当が来たら交代する。\nお客様を一人にして待たせない。', '重要', '接客'],
    ['予約時間を過ぎても来店がない',
     '担当キャスト（または予約者）に来店状況を確認し、席をいつまで空けるか判断する。\n連絡せずに席を空けたまま待ち続けない。勝手にキャンセル扱いにもしない。', '', '予約'],
    ['予約のない新規のお客様',
     '会員制の受付手順（紹介者の確認）に沿って対応する。\nイレギュラーは自己判断で通さず、運営の指示を仰ぐ。', '禁止', '会員制'],
    ['年齢確認',
     '未成年の可能性があるお客様には年齢確認を行い、未成年なら丁寧にお断りする。', '禁止', '会員制'],
    ['会員登録でとる項目',
     '複数人でのご来店なら、まず誰が会員かを確認する。\n名前・生年月日・ネック名を記録し、公式LINEの登録と、登録後の返信までいただく。', '重要', '会員制'],
    ['当日予約が入ったら',
     '口頭共有で終わらせず、システムに予約を追加する。\n席を用意し、担当・会員のボトルを準備しておく。', '', '予約']
  ]},

  { ch: '席とキャスト（付け回し）', emoji: '🪑', items: [
    ['付け回しの原則',
     '特定のキャストに偏らせない。仲の良いキャストを優遇しない。\n全体の席の状況を見て、公平に回す。', '重要', '付け回し'],
    ['キャストを別の席へ移すときの声かけ',
     'すぐに声をかける。抜けてこられなさそうであれば、\n「お客様、失礼します。〇〇さん少しお借りします」と一言添えて、スムーズに席移動をお願いする。\n会話の途中で無言で連れ出さない。お客様の前で「人が足りないので」とは言わない。', '重要', '付け回し'],
    ['キャストのリクエストが入ったら',
     'LINE・インカムで他の黒服に共有し、全体の席の状況を見て回すタイミングを作る。\n他席を空けてまで即座に付けない。手が空くまで放置もしない。', '', '付け回し'],
    ['団体席にキャストを付ける位置',
     '偏りが出ないよう、バランスよく間に入れる。必要なら丸椅子に座らせるよう指示する。', '', '付け回し'],
    ['混雑時の休憩',
     '混雑している時に認めるのは、トイレと、酔った時の水分補給のみ。\nタバコ休憩は今は人手が足りないため断る。', '重要', 'キャスト対応'],
    ['同伴で出勤したキャスト',
     '出勤後すぐ席に着けるよう声をかける。時給が発生していることを意識させる。\nお客様の前で叱らない。', '', 'キャスト対応'],
    ['出勤時間と席入り',
     '20時出勤の子は20時に、20時半出勤の子は20時半に席に着けるよう準備させる。\n同伴組は20時半に必ず間に合うよう、飲食店とお客様に改めて伝える。', '', 'キャスト対応'],
    ['キャストを守るのも黒服の仕事',
     'お客様が執拗にアフターや連絡先を迫っている時は、さりげなく間に入ってキャストを守る。\nキャストに応じさせない。見て見ぬふりをしない。', '重要', 'キャスト対応'],
    ['キャストの体調不良',
     '無理させず休ませ、状況により早退も検討する。気合で最後まで、はさせない。', '', 'キャスト対応'],
    ['キャスト同士のトラブル',
     'お客様の前には出さない。後で双方の話を公平に聞く。その場で片方を叱らない。', '', 'キャスト対応'],
    ['⚠️注意情報の警告が出たら',
     '予約や付け回しで「NGキャスト」「同席NG」などの警告が軍師に出たら、無視して座らせない。\n警告は過去に実際に事故が起きた組み合わせ。必ず別の手を考える。', '禁止', '軍師']
  ]},

  { ch: 'ドリンク・ボトル', emoji: '🍶', items: [
    ['ボトルは購入したお客様のもの',
     'ご紹介で来られた「枝」のお客様が「紹介者（幹）のボトルを飲みたい」と言っても、無断で出さない。\n黒服の判断で出さず、担当に確認して幹の許可が確認できるまで出さない。', '禁止', 'ボトル'],
    ['ボトルの保管',
     'お預かりしたボトルは、決められた棚の正しい位置に戻す。\n位置が違うだけで、次の来店で出せず機会損失になる。\n軍師の「🍶ボトル棚マップ」で位置を確認できる。', '重要', 'ボトル'],
    ['ネック（タグ）の作り方',
     '裏面の必要事項を、最初から正しく書く。\n「00/00」で作って後から上貼りで直すのは禁止。\n顧客管理にも必ず登録・更新する。', '禁止', 'ボトル'],
    ['メニューにない物を頼まれたら',
     '担当に確認する。仕入れるなら売値を運営と決める。その場で勝手に決めない・勝手に断らない。', '', 'メニュー'],
    ['出前を頼まれたら',
     'メニューをお渡しし、注文は黒服が電話で入れる。お客様に直接電話させない。', '', 'メニュー'],
    ['酔っているお客様に強い酒を頼まれたら',
     '体調と安全を優先し、水やソフトドリンクを勧める。\n言われるままにどんどん出さない。勝手に会計して帰すのも違う。', '重要', '接客'],
    ['理不尽なクレームを受けたら',
     'まず最後まで話を聞き、落ち着いて事実を確認する。\nすぐ言い返さない。キャストのせいにしない。聞こえないふりをしない。', '', '接客']
  ]},

  { ch: '清掃・店内の維持', emoji: '🧹', items: [
    ['トイレのレストチェック',
     'こまめに（お客様の入れ替わりのタイミング等で）確認する。\n便座裏と床まで見る。正面だけ見て終わりにしない。\nお客様から指摘されてからでは遅い。', '重要', '清掃'],
    ['店内清掃',
     '開店前に完了させる。営業中も灰皿・テーブル周り・グラスを常に整える。\n「運営からの4Sチェック」に基づいた作業も開店前チェックに含まれる。', '', '清掃']
  ]},

  { ch: '会計（チェック）', emoji: '🧾', items: [
    ['チェックを出す時間',
     '24時以降からチェック可能な席に、順にチェックを出していく（23:45の合図から動き出す）。\n24時20分までには全卓のチェックが終わるように進める。\n時間ギリギリまで待たない。お客様から言われるまで待たない。', '重要', '会計'],
    ['写真を送る前に、必ず自分で突き合わせる',
     '会計チェックの写真を送る前に、手書き伝票とPOSを突き合わせる。\nボトル・人数・キャストドリンク・割引・年会費が合っているかを自分で確認してから送る。\nとりあえず送って指摘されてから直す、はやらない。', '禁止', '会計'],
    ['POSは客前で操作しない',
     'POS（会計）の操作はカウンター内・裏で行う。\n客前の画面には他席のチェックも映る。キャストには操作させない。', '禁止', '会計'],
    ['領収書',
     '実際の飲食内容どおりにしか発行できない。\n宛名を別の会社に、金額を多めに、という依頼は丁寧にお断りする。', '禁止', '会計'],
    ['領収書のために端末の日付を変えたら',
     '使い終わったら必ず日付を元に戻す。\n戻し忘れると、それ以降の伝票が全部ずれる。過去に2度起きている。', '禁止', '会計'],
    ['会計が終わったら',
     'お預かりの荷物・お土産をすべてキャストに渡し、スムーズな退店を促す。\n入店直後やチェックのかなり前に出さない。', '', '会計']
  ]},

  { ch: '退店・送り', emoji: '🚗', items: [
    ['完全退店は24:30',
     '24:30の完全退店から逆算して動く。23:45以降、順番にチェックを出していく。', '重要', '退店'],
    ['同伴組の退店',
     '予約状況によっては、同伴組に22時半までの退店をお願いすることがある。\n店側から協力要請が出たら、担当を通してお願いする。', '', '退店'],
    ['酔っているお客様を一人で帰さない',
     '目立って酔った状態のお客様は、送り（タクシー／ドライバー）を手配して安全に帰す。\n一人でそのまま帰さない。放置しない。', '重要', '送り'],
    ['送りの段取り',
     '22:30に送りサマリー、23:30に送り確認がLINEに流れる。\n依頼は軍師の「🚗送り管理」に登録する。登録がないと配車が組めない。', '', '送り']
  ]},

  { ch: '閉店・締め', emoji: '🌙', items: [
    ['23時ごろ：日払いの準備',
     '日払い・ドライバー日払いの準備をしておく。\nキャストが帰り支度をしてすぐ降りられる状態にしておく。', '', '閉店'],
    ['日払いの計算と受領書',
     'POSの支払金額 × 0.8979 で算出する。\n受領書を作成し、現金と一緒に写真を撮る。\n1,000円札は使わない。', '重要', '現金'],
    ['消灯（24:30までに）',
     '外看板／外照明、2階／5階のラウンジ入口照明を消す。\n目視かカメラで本当に消えているか確認してから「完了」と報告する。\n未確認の完了報告→カメラで全点灯が発覚、を過去に繰り返している。', '重要', '閉店'],
    ['現金チェック（00:30）',
     '軍師の「🌙閉店チェック」から申請する。\n⚠️「◯円多い／足りません」と出たら、そのまま送信しない。\n開店金庫・経費・日払い・出金を確認して原因を潰してから送る。差額を勝手に調整して合わせるのも禁止。', '禁止', '現金'],
    ['退勤の関門',
     '現金チェックに合格するまで、退勤報告は受け付けられない。\n「退勤しました」と送っても弾かれる。締めを終わらせてから退勤する。', '重要', '現金'],
    ['発注チェックシートの提出',
     '24:30〜1:00に、チェックシート（特に発注）を写真で黒服グループに提出する。\n翌週まとめて、口頭で、は不可。', '', '閉店'],
    ['おしぼり発注（木・日）',
     '閉店後、おしぼりを通路に出して、発注数を書いた紙を置いておく。', '', '閉店'],
    ['申し送りを残す',
     '軍師の「📋申し送りを書く」から、その日の出来事と翌日への引き継ぎを残す。\n翌日の黒服のホーム最上段に出るので、必ず読まれる。\n口頭で伝えたつもりは、伝わっていない。', '重要', '軍師']
  ]},

  { ch: '現金の扱い', emoji: '💴', items: [
    ['現金は4つに分けて管理する',
     '① 5Fレジ　② 2Fレジ　③ 経費袋　④ 金庫\nこの4つを分けたまま管理し、分けたまま報告する。\n合算して報告するとミスの元になる。', '重要', '現金'],
    ['締めの現金の数え方',
     '5F・2Fそれぞれ、10,000円／5,000円／1,000円を紙幣別に数える。\n5Fの10,000円札は7枚以上あること。', '', '現金'],
    ['金庫からの出金',
     '軍師の「🔓金庫出金」から記録する。\n記録のない出金は、そのまま締めの差額になる。', '重要', '現金'],
    ['経費を立て替えたら',
     '一般経費を立て替えた時は、軍師の「💴経費立替」から申請する。店の現金で精算する。\n黙って立て替えたままにしない。', '', '現金']
  ]},

  { ch: '軍師の使い方', emoji: '🏯', items: [
    ['軍師とは',
     '店のiPadで動く、黒服専用のシステム。\n予約・席・キャスト・現金・伝票・在庫を全部ここで扱う。\nURLは18:00に黒服グループLINEへ届く。', '', '軍師'],
    ['開いたら最初に見るもの',
     'ホームの上から順に見る。\n① ⚠️発注したのに届いていない（未着アラート）\n② 📋今日の申し送り\n③ ⏱出退勤の打刻\nここに今日の地雷が出ている。', '重要', '軍師'],
    ['3つのフェーズ',
     '🌅開店前 → 🔥営業中 → 🌙閉店 の3つで画面が切り替わる（18:30が開店前と営業中の境）。\nフェーズごとに「今やること」が出る。', '', '軍師'],
    ['入力の基本の型',
     '来店時に伝票を立てる → 席・担当・時間を正しく登録する → 会計後は締めまで完了させる。\n「できる時にまとめて入力」はしない。客名や時間を空欄のままにしない。担当を後で適当に付けない。', '重要', '軍師'],
    ['業務メニュー',
     'ホーム下の「🗂業務メニュー」に、顧客管理・ボトル棚マップ・送り管理・在庫発注・伝票管理・領収書などが並ぶ。\n探す前にここを一度見る。', '', '軍師'],
    ['動かない・エラーが出た時',
     'まず一度リロードする（ホーム画面から開き直す）。\nそれでも直らなければ、黒服グループLINEに「どの画面で何をしたら何が出たか」を書いて報告する。', '', '軍師']
  ]},

  { ch: 'やってはいけないこと', emoji: '⛔', items: [
    ['禁止事項まとめ',
     '・お客様やキャストの個人情報を教える（誰が来店しているかも含む）\n・幹の許可なく、ボトルを出す\n・客前でPOSを操作する\n・実態と違う領収書を書く\n・手書き伝票と突き合わせずに会計チェックの写真を送る\n・差額の警告を無視して現金チェックを送信する\n・目視・カメラで確認せずに「完了」と報告する\n・LINEの指示を未読・既読スルーする\n・自己判断で新規のお客様を通す\n・ネックを「00/00」で作って上貼りで直す\n・混雑時にタバコ休憩へ行かせる\n・未成年と分かって入店させる', '禁止', 'まとめ']
  ]}
];

// ============================================================
// 低レベルヘルパー
// ============================================================
function manualSheet_() {
  var ss = getOrOpenSS_();
  var sh = ss.getSheetByName(MANUAL_TAB_);
  if (!sh) { sh = ss.insertSheet(MANUAL_TAB_); sh.appendRow(MANUAL_HEAD_); sh.setFrozenRows(1); }
  return sh;
}
function manualNow_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function manualId_() { return 'M' + (new Date().getTime()).toString(36) + Math.floor(Math.random() * 46656).toString(36); }
function manualBool_(v) { return !(v === false || String(v).toUpperCase() === 'FALSE' || String(v).trim() === ''); }

// 空のときだけ初期本文を投入
function manualEnsureSeed_() {
  var sh = manualSheet_();
  if (sh.getLastRow() >= 2) return sh;
  var rows = [], now = manualNow_();
  for (var c = 0; c < MANUAL_DEFAULTS_.length; c++) {
    var chap = MANUAL_DEFAULTS_[c];
    for (var i = 0; i < chap.items.length; i++) {
      var it = chap.items[i];
      rows.push([manualId_(), chap.ch, c + 1, i + 1, chap.emoji, it[0], it[1], it[2] || '', it[3] || '', true, now, '初期投入']);
    }
  }
  if (rows.length) sh.getRange(2, 1, rows.length, MANUAL_HEAD_.length).setValues(rows);
  return sh;
}

// 全行を読む（無効も含む）
function manualRows_() {
  manualEnsureSeed_();
  var sh = manualSheet_();
  var vals = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var id = String(vals[i][0]).trim();
    if (!id) continue;
    out.push({
      id: id,
      ch: String(vals[i][1] || '').trim(),
      chOrder: Number(vals[i][2]) || 0,
      order: Number(vals[i][3]) || 0,
      emoji: String(vals[i][4] || ''),
      title: String(vals[i][5] || ''),
      body: String(vals[i][6] || ''),
      level: String(vals[i][7] || '').trim(),
      tags: String(vals[i][8] || '').trim(),
      active: manualBool_(vals[i][9]),
      at: String(vals[i][10] || ''),
      by: String(vals[i][11] || ''),
      row: i + 1
    });
  }
  out.sort(function (a, b) { return (a.chOrder - b.chOrder) || (a.order - b.order); });
  return out;
}

// 章ごとにまとめる
function manualGroup_(rows) {
  var map = {}, chapters = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!map[r.ch]) { map[r.ch] = { ch: r.ch, emoji: r.emoji, chOrder: r.chOrder, items: [] }; chapters.push(map[r.ch]); }
    if (!map[r.ch].emoji && r.emoji) map[r.ch].emoji = r.emoji;
    map[r.ch].items.push({ id: r.id, title: r.title, body: r.body, level: r.level, tags: r.tags, order: r.order, active: r.active });
  }
  chapters.sort(function (a, b) { return a.chOrder - b.chOrder; });
  return chapters;
}

// ============================================================
// 軍師（黒服iPad）— 読み取り専用。⚠️GUNSHI_API_FNS 登録必須
// ============================================================
function gunshiGetManual() {
  var rows = manualRows_().filter(function (r) { return r.active; });
  var last = '';
  for (var i = 0; i < rows.length; i++) if (rows[i].at > last) last = rows[i].at;
  return { ok: true, chapters: manualGroup_(rows), count: rows.length, updated: last };
}

// ============================================================
// コンソール（管理者のみ）— 編集
// ============================================================
function manualAdminData_() {
  var rows = manualRows_();
  return { ok: true, chapters: manualGroup_(rows), rows: rows, levels: MANUAL_LEVELS_ };
}

// 新規/更新（idがあれば更新）。章順は同じ章の既存行から継承、無ければ末尾の章として追加。
function manualAdminSave_(item, by) {
  if (!item) return { ok: false, error: '内容がありません' };
  var ch = String(item.ch || '').trim();
  var title = String(item.title || '').trim();
  if (!ch) return { ok: false, error: '章を入れてください' };
  if (!title) return { ok: false, error: 'タイトルを入れてください' };
  var sh = manualSheet_();
  var rows = manualRows_();
  var id = String(item.id || '').trim();

  // 章順・絵文字：既存の同名章に合わせる
  var chOrder = 0, emoji = String(item.emoji || '').trim(), maxChOrder = 0, maxOrder = 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].chOrder > maxChOrder) maxChOrder = rows[i].chOrder;
    if (rows[i].ch === ch) {
      chOrder = rows[i].chOrder;
      if (!emoji) emoji = rows[i].emoji;
      if (rows[i].order > maxOrder) maxOrder = rows[i].order;
    }
  }
  if (!chOrder) chOrder = maxChOrder + 1;

  var level = String(item.level || '').trim();
  if (MANUAL_LEVELS_.indexOf(level) < 0) level = '';
  var active = (item.active === false) ? false : true;
  var now = manualNow_();

  if (id) {
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].id !== id) continue;
      var order = (rows[j].ch === ch) ? rows[j].order : (maxOrder + 1);
      sh.getRange(rows[j].row, 1, 1, MANUAL_HEAD_.length).setValues([[
        id, ch, chOrder, order, emoji, title, String(item.body || ''), level, String(item.tags || '').trim(), active, now, by || ''
      ]]);
      return { ok: true, id: id };
    }
    return { ok: false, error: '項目が見つかりません: ' + id };
  }
  var newId = manualId_();
  sh.appendRow([newId, ch, chOrder, maxOrder + 1, emoji, title, String(item.body || ''), level, String(item.tags || '').trim(), active, now, by || '']);
  return { ok: true, id: newId };
}

function manualAdminDelete_(id) {
  id = String(id || '').trim();
  if (!id) return { ok: false, error: 'idがありません' };
  var rows = manualRows_(), sh = manualSheet_();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === id) { sh.deleteRow(rows[i].row); return { ok: true }; }
  }
  return { ok: false, error: '項目が見つかりません' };
}

// 同じ章の中で1つ上/下へ（dir: -1=上 / 1=下）
function manualAdminMove_(id, dir) {
  id = String(id || '').trim();
  dir = (Number(dir) < 0) ? -1 : 1;
  var rows = manualRows_(), sh = manualSheet_();
  var cur = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) cur = rows[i];
  if (!cur) return { ok: false, error: '項目が見つかりません' };
  var sibs = rows.filter(function (r) { return r.ch === cur.ch; });
  var idx = -1;
  for (var j = 0; j < sibs.length; j++) if (sibs[j].id === id) idx = j;
  var tgt = idx + dir;
  if (tgt < 0 || tgt >= sibs.length) return { ok: true, moved: false };
  var a = sibs[idx], b = sibs[tgt];
  sh.getRange(a.row, 4).setValue(b.order);
  sh.getRange(b.row, 4).setValue(a.order);
  return { ok: true, moved: true };
}

// 章まるごとの並べ替え（dir: -1=上 / 1=下）
function manualAdminMoveChapter_(ch, dir) {
  ch = String(ch || '').trim();
  dir = (Number(dir) < 0) ? -1 : 1;
  var rows = manualRows_(), sh = manualSheet_();
  var chapters = manualGroup_(rows);
  var idx = -1;
  for (var i = 0; i < chapters.length; i++) if (chapters[i].ch === ch) idx = i;
  if (idx < 0) return { ok: false, error: '章が見つかりません' };
  var tgt = idx + dir;
  if (tgt < 0 || tgt >= chapters.length) return { ok: true, moved: false };
  var aOrder = chapters[idx].chOrder, bOrder = chapters[tgt].chOrder;
  for (var j = 0; j < rows.length; j++) {
    if (rows[j].ch === chapters[idx].ch) sh.getRange(rows[j].row, 3).setValue(bOrder);
    else if (rows[j].ch === chapters[tgt].ch) sh.getRange(rows[j].row, 3).setValue(aOrder);
  }
  return { ok: true, moved: true };
}

// 章名の一括変更（項目を移し替えずに章だけリネーム）
function manualAdminRenameChapter_(oldCh, newCh, emoji) {
  oldCh = String(oldCh || '').trim(); newCh = String(newCh || '').trim();
  if (!oldCh || !newCh) return { ok: false, error: '章名がありません' };
  var rows = manualRows_(), sh = manualSheet_(), n = 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].ch !== oldCh) continue;
    sh.getRange(rows[i].row, 2).setValue(newCh);
    if (emoji != null && String(emoji).trim()) sh.getRange(rows[i].row, 5).setValue(String(emoji).trim());
    n++;
  }
  return { ok: true, updated: n };
}

// 定番本文の再投入（既存タイトルはスキップ＝冪等。消してしまった章を戻す用）
function manualSeedDefaults_() {
  manualEnsureSeed_();
  var sh = manualSheet_();
  var rows = manualRows_();
  var have = {};
  for (var i = 0; i < rows.length; i++) have[rows[i].ch + ' ' + rows[i].title] = true;
  var maxChOrder = 0;
  for (var k = 0; k < rows.length; k++) if (rows[k].chOrder > maxChOrder) maxChOrder = rows[k].chOrder;
  var add = [], now = manualNow_();
  for (var c = 0; c < MANUAL_DEFAULTS_.length; c++) {
    var chap = MANUAL_DEFAULTS_[c];
    var chOrder = 0, maxOrder = 0;
    for (var r = 0; r < rows.length; r++) {
      if (rows[r].ch !== chap.ch) continue;
      chOrder = rows[r].chOrder;
      if (rows[r].order > maxOrder) maxOrder = rows[r].order;
    }
    if (!chOrder) { maxChOrder++; chOrder = maxChOrder; }
    for (var i2 = 0; i2 < chap.items.length; i2++) {
      var it = chap.items[i2];
      if (have[chap.ch + ' ' + it[0]]) continue;
      maxOrder++;
      add.push([manualId_(), chap.ch, chOrder, maxOrder, chap.emoji, it[0], it[1], it[2] || '', it[3] || '', true, now, '定番投入']);
    }
  }
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, MANUAL_HEAD_.length).setValues(add);
  return { ok: true, added: add.length };
}

// 定番の内容に戻す（シートの中身を捨てて初期本文で入れ直す）。
//   使う場面＝①定番側の文言を直したので本番にも反映したい ②編集でぐちゃぐちゃにしたので戻したい
//   ⚠️破壊的。人が手で編集した項目も消える。呼び出し側(コンソール)で必ず確認を取ること。
//   force!==true のときは、人の編集が1件でもあれば実行せず、件数だけ返して止まる。
function manualResetToDefaults_(force) {
  var rows = manualRows_();
  var edited = rows.filter(function (r) { return r.by && r.by !== '初期投入' && r.by !== '定番投入'; });
  if (edited.length && force !== true) {
    return { ok: false, needConfirm: true, edited: edited.length,
             error: '手で編集された項目が ' + edited.length + ' 件あります。戻すと消えます。' };
  }
  var sh = manualSheet_();
  var last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
  // 見出しだけ残った状態から初期本文を入れ直す
  var out = [], now = manualNow_();
  for (var c = 0; c < MANUAL_DEFAULTS_.length; c++) {
    var chap = MANUAL_DEFAULTS_[c];
    for (var i = 0; i < chap.items.length; i++) {
      var it = chap.items[i];
      out.push([manualId_(), chap.ch, c + 1, i + 1, chap.emoji, it[0], it[1], it[2] || '', it[3] || '', true, now, '初期投入']);
    }
  }
  if (out.length) sh.getRange(2, 1, out.length, MANUAL_HEAD_.length).setValues(out);
  return { ok: true, wrote: out.length, discarded: rows.length, edited: edited.length };
}

// 章の一覧（スキルテストの「章」割り当て用。空の章は出さない）
function manualChapterList_() {
  var rows = manualRows_().filter(function (r) { return r.active; });
  return manualGroup_(rows).map(function (c) { return { ch: c.ch, emoji: c.emoji, count: c.items.length }; });
}
