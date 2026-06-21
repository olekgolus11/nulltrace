# NullTrace

NullTrace supports an operator-led penetration testing session by turning scanner output into reviewable security signals.

## Language

**Finding**:
A security-relevant signal observed during a testing session and produced from scanner output. A finding records what the tooling observed, not the operator's judgment about it.
_Avoid_: Vulnerability, vuln, issue, alert

**Finding Review**:
The operator's judgment about a finding. A finding review records how the operator has triaged the finding without changing what the tooling observed, and exists only after the operator first interacts with the finding.
_Avoid_: Finding, scanner result

**Review Status**:
The operator-assigned state of a finding review: needs review, confirmed, or dismissed. A finding without an explicit review is treated as needs review, and a review status does not describe whether the finding still exists on the target.
_Avoid_: Finding status, resolved status

**Source Context**:
The scanner-derived details shown to help an operator understand why a finding exists. Source context is displayed from the finding's lightweight payload and may reference the original artifact, but it is not a separate record or source of truth.
_Avoid_: Evidence, proof, raw artifact

**Conversation**:
A single AI chat thread attached to a testing session. A testing session may have multiple conversations; the chat runtime owns each conversation's message history and title, while NullTrace stores the runtime conversation identifier needed to list, reopen, or remove the attachment.
_Avoid_: Chat log, local message store

**Conversation Attachment**:
The association between a NullTrace testing session and a runtime-owned conversation. Conversation attachments let NullTrace show or archive the conversations available inside a session without owning their message history or deleting the runtime-owned conversation.
_Avoid_: Conversation record, message record

**Archived Conversation Attachment**:
A conversation attachment hidden from the active session conversation list without deleting the runtime-owned conversation. NullTrace may archive an attachment at the operator's request or when its conversation cannot be safely reopened from the session's workspace; archived attachments are not restored in the initial chat foundation workflow.
_Avoid_: Deleted conversation, removed OpenCode session

**Default Conversation**:
The first conversation automatically attached to a testing session so the operator can start chatting without manually creating a thread. Additional conversations are operator-created.
_Avoid_: Primary chat, singleton chat

**Chat Context**:
Session data deliberately made available to a conversation, such as selected findings, source context, tool run artifacts, and the known tool catalog. It excludes files and instructions inherited solely from the environment where NullTrace was launched.
_Avoid_: Prompt dump, global session memory

**Chat Context Tool**:
A read-only capability exposed to the chat runtime so AI can inspect NullTrace session data. Chat context tools may read findings, artifacts, and tool metadata, but they do not run scanner tools or mutate review state.
_Avoid_: Scanner tool, execution tool

**Chat Web Access**:
The conversation's unrestricted ability to retrieve internet resources, including pages belonging to the testing target, for research and inspection. Web access is separate from scanner execution and Chat Context.
_Avoid_: Chat Context Tool, scanner run

**Chat Provider Credentials**:
The operator's authorization for NullTrace to use an AI provider. NullTrace owns these credentials independently of any external OpenCode installation; they may be shared across Session Chat Workspaces but carry no chat instructions, tools, commands, or agent customizations.
_Avoid_: Chat configuration, agent profile

**Session Chat Workspace**:
The isolated runtime scope containing conversations for exactly one testing session. It persists across application restarts, is not shared with other testing sessions or the environment where NullTrace was launched, and exposes session information only through Chat Context.
_Avoid_: Repository workspace, global chat workspace
