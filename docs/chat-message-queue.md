# Direct-conversation message queue

During a supported direct Agent conversation, **发送** sends the current input
to the active execution. **排队** keeps it pending until the current reply ends.
In **设置 → 聊天 → 回复中按 Enter**, users can choose **立即发送** (the default)
or **排队**. This preference is saved in the browser and only applies during
an active reply. Clicking **发送** always sends immediately; Shift+Enter inserts
a newline. Editing a message still uses Enter to save.

QwenPaw conversations show **发送会打断当前会话** during a reply. The send
buttons keep the same labels across runtimes.

Above the composer, **3 条排队中** opens an ordered summary list on desktop
hover or click. Each summary is limited to two lines; hovering, focusing or
clicking a summary opens the full text above the list. The full text and list
have bounded heights and scroll independently. Touch users can tap both levels.
The queue title and automatic-send explanation share one line.
Each row has **发送** and **删除** actions. 发送 sends the selected input now,
using the current run's steer control while it is active, and preserves the
relative order of the remaining entries. 删除 removes unsent input only.

The queue releases one entry for each verified Agent `completed` receipt.
Successful HTTP delivery, typing changes, Stop and failure receipts do not
release the next entry. The same completed run cannot drain a second input
while the next run is starting. Failed sends retain the entry and its error
for explicit retry; they do not silently drop input or repeatedly auto-send.

Queues belong to the current browser tab, Matrix account, homeserver and room.
They continue processing while the user switches rooms or Dashboard sections.
They are held in memory and do not survive closing or refreshing the page.
Mentions, quoted reply targets and workspace file references are captured with
the queued input using the normal outbound-message builder. File uploads keep
their existing immediate upload/send flow. Group-room runtime queues are
outside this UI change.
