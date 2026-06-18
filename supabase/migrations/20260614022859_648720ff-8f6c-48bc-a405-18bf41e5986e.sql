-- 1. chat_tasks
create table public.chat_tasks (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  message_id uuid references public.chat_messages(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  title text not null,
  description text,
  assignee uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','done')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
grant select, insert, update, delete on public.chat_tasks to authenticated;
grant all on public.chat_tasks to service_role;
alter table public.chat_tasks enable row level security;

create policy "members read tasks" on public.chat_tasks for select to authenticated
  using (exists (select 1 from public.chat_conversation_members m
                 where m.conversation_id = chat_tasks.conversation_id and m.user_id = auth.uid()));
create policy "members insert tasks" on public.chat_tasks for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.chat_conversation_members m
                 where m.conversation_id = chat_tasks.conversation_id and m.user_id = auth.uid()));
create policy "members update tasks" on public.chat_tasks for update to authenticated
  using (exists (select 1 from public.chat_conversation_members m
                 where m.conversation_id = chat_tasks.conversation_id and m.user_id = auth.uid()));
create policy "creators delete tasks" on public.chat_tasks for delete to authenticated
  using (created_by = auth.uid());

create index chat_tasks_conv on public.chat_tasks(conversation_id, status);
create index chat_tasks_lead on public.chat_tasks(lead_id);
create index chat_tasks_assignee on public.chat_tasks(assignee, status);

-- 2. Extend presence enum
alter type public.chat_presence_status add value if not exists 'on_call';
alter type public.chat_presence_status add value if not exists 'quoting';
alter type public.chat_presence_status add value if not exists 'follow_up';
alter type public.chat_presence_status add value if not exists 'lunch';
alter type public.chat_presence_status add value if not exists 'break';
alter type public.chat_presence_status add value if not exists 'meeting';
alter type public.chat_presence_status add value if not exists 'dnd';

-- 3. Announcement metadata on chat_messages
alter table public.chat_messages
  add column if not exists is_high_priority boolean not null default false,
  add column if not exists requires_ack boolean not null default false,
  add column if not exists is_pinned_announcement boolean not null default false;

-- 4. chat_templates
create table public.chat_templates (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  is_shared boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.chat_templates to authenticated;
grant all on public.chat_templates to service_role;
alter table public.chat_templates enable row level security;

create policy "read own or shared templates" on public.chat_templates for select to authenticated
  using (owner = auth.uid() or is_shared = true or owner is null);
create policy "insert own templates" on public.chat_templates for insert to authenticated
  with check (owner = auth.uid() or owner is null);
create policy "update own templates" on public.chat_templates for update to authenticated
  using (owner = auth.uid());
create policy "delete own templates" on public.chat_templates for delete to authenticated
  using (owner = auth.uid());

-- Seed shared sales templates
insert into public.chat_templates (owner, title, body, is_shared) values
  (null, 'Take this transfer?', 'Can someone take this transfer?', true),
  (null, 'Ready for follow-up', 'Customer is ready for follow-up.', true),
  (null, 'Help quoting risk', 'Need help quoting this risk.', true),
  (null, 'Please review lead', 'Please review this lead.', true),
  (null, 'Home + auto bundle', 'Customer asked for home + auto bundle.', true),
  (null, 'Call back requested', 'Call back requested.', true);
