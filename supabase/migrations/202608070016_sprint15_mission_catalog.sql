-- KVNX Vault Sprint 15: server-authoritative mission catalog and variety.
-- Apply after 202608070015_sprint14_authoritative_streaks.sql.
-- Installed migrations 001-015 remain immutable. There is intentionally no 010.

create table public.mission_catalog (
  template_key text primary key,
  focus_key text not null,
  title text not null,
  description text not null,
  primary_skill_key text not null references public.skill_catalog(skill_key),
  estimated_minutes integer not null check (estimated_minutes between 5 and 240),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mission_catalog_template_key_format
    check (template_key ~ '^[a-z][a-z0-9-]{2,95}$'),
  constraint mission_catalog_focus_key_valid
    check (focus_key in (
      'career', 'business', 'programming', 'fitness', 'health', 'learning',
      'creativity', 'finance', 'relationships', 'mindset', 'general'
    )),
  constraint mission_catalog_title_nonempty check (char_length(trim(title)) between 3 and 120),
  constraint mission_catalog_description_nonempty check (char_length(trim(description)) between 10 and 300)
);

create index mission_catalog_active_focus_idx
  on public.mission_catalog(focus_key, active, template_key);

create trigger mission_catalog_set_updated_at
before update on public.mission_catalog
for each row execute function public.set_updated_at();

alter table public.mission_catalog enable row level security;

-- Catalog data is consumed only by SECURITY DEFINER mission authorities. The
-- selected immutable snapshot is returned through the existing daily RPCs.
revoke all on public.mission_catalog from public, anon, authenticated;

insert into public.mission_catalog (
  template_key, focus_key, title, description, primary_skill_key, estimated_minutes
) values
  ('career-priority-action', 'career', 'Advance One Career Priority', 'Complete the highest-leverage action available for your current career direction.', 'leadership', 30),
  ('career-strength-audit', 'career', 'Audit a Core Strength', 'Identify one professional strength and define how you will apply it more deliberately.', 'leadership', 20),
  ('career-skill-gap', 'career', 'Close One Skill Gap', 'Choose one career skill gap and complete a focused practice session against it.', 'leadership', 30),
  ('career-opportunity-map', 'career', 'Map the Next Opportunity', 'Write the next credible career opportunity and the concrete step that moves you toward it.', 'leadership', 20),
  ('career-work-improvement', 'career', 'Improve One Work Standard', 'Raise the quality of one recurring task, process, or professional deliverable.', 'leadership', 30),
  ('career-conversation', 'career', 'Initiate a Valuable Conversation', 'Reach out for one conversation that can create clarity, feedback, or opportunity.', 'leadership', 15),

  ('business-leverage-task', 'business', 'Complete the Highest-Leverage Task', 'Identify the business action with the greatest current impact and finish it.', 'business', 30),
  ('business-assumption-review', 'business', 'Test One Business Assumption', 'Review one important assumption and record the evidence supporting or challenging it.', 'business', 25),
  ('business-customer-improvement', 'business', 'Improve the Customer Experience', 'Strengthen one specific point in the product, offer, or customer journey.', 'business', 30),
  ('business-offer-clarity', 'business', 'Clarify the Offer', 'Refine one part of your offer so its value is easier to understand and act on.', 'business', 25),
  ('business-bottleneck', 'business', 'Remove One Bottleneck', 'Find the constraint slowing execution and complete one action that reduces it.', 'business', 30),
  ('business-metric-review', 'business', 'Review a Meaningful Metric', 'Inspect one useful business metric and decide the next action it supports.', 'business', 20),

  ('programming-deep-work', 'programming', 'Complete a Focused Coding Session', 'Work on one implementation without switching tasks until a clear checkpoint is reached.', 'front_end_engineering', 30),
  ('programming-refactor', 'programming', 'Refactor One Weak Point', 'Improve one piece of code whose structure, naming, or maintainability can be stronger.', 'front_end_engineering', 30),
  ('programming-solve-problem', 'programming', 'Solve One Technical Problem', 'Choose one defined technical problem and work it through without changing scope.', 'front_end_engineering', 30),
  ('programming-review-implementation', 'programming', 'Review a Recent Implementation', 'Inspect recent code and correct one concrete weakness in quality or reliability.', 'front_end_engineering', 25),
  ('programming-test-edge-case', 'programming', 'Strengthen an Edge Case', 'Add or improve one test for behavior that could fail outside the happy path.', 'front_end_engineering', 25),
  ('programming-document-decision', 'programming', 'Document a Technical Decision', 'Capture one important implementation decision and the tradeoff behind it.', 'front_end_engineering', 20),

  ('fitness-training-session', 'fitness', 'Complete an Intentional Training Session', 'Train with a defined purpose and complete the session you planned.', 'fitness', 30),
  ('fitness-measurable-improvement', 'fitness', 'Improve One Measurable Detail', 'Choose one movement, pace, load, or duration and improve it with control.', 'fitness', 25),
  ('fitness-mobility', 'fitness', 'Restore Mobility', 'Complete a focused mobility session for the area that needs the most attention.', 'fitness', 20),
  ('fitness-conditioning', 'fitness', 'Build Your Conditioning', 'Complete one controlled conditioning block and record the result.', 'fitness', 25),
  ('fitness-technique', 'fitness', 'Refine Your Technique', 'Practice one movement pattern with deliberate form and no rushed repetitions.', 'fitness', 20),
  ('fitness-recovery-plan', 'fitness', 'Strengthen Your Recovery Plan', 'Complete one recovery action that supports the quality of your next training session.', 'fitness', 15),

  ('health-supportive-action', 'health', 'Complete One Supportive Health Action', 'Take one deliberate action that directly supports your physical well-being.', 'fitness', 20),
  ('health-meal-upgrade', 'health', 'Improve One Meal', 'Make one practical improvement to the quality or balance of a meal today.', 'fitness', 20),
  ('health-sleep-preparation', 'health', 'Prepare for Better Sleep', 'Complete one intentional step that improves tonight’s sleep environment or routine.', 'fitness', 15),
  ('health-energy-audit', 'health', 'Audit Your Energy', 'Identify one behavior affecting your energy and choose a specific adjustment.', 'fitness', 15),
  ('health-outdoor-movement', 'health', 'Move Outside With Intention', 'Complete a purposeful outdoor movement session without digital distraction.', 'fitness', 25),
  ('health-routine-improvement', 'health', 'Improve One Health Routine', 'Strengthen one repeatable health habit by making the next action easier to execute.', 'fitness', 20),

  ('learning-deep-concept', 'learning', 'Learn One Concept Deeply', 'Study one concept until you can explain its core idea without relying on notes.', 'learning', 30),
  ('learning-recall', 'learning', 'Practice Active Recall', 'Close the source and reconstruct the most important ideas from memory.', 'learning', 20),
  ('learning-gap-review', 'learning', 'Find One Knowledge Gap', 'Review previous material and identify one gap that deserves focused study.', 'learning', 25),
  ('learning-apply-concept', 'learning', 'Apply What You Learned', 'Use one recently learned concept in a concrete example, exercise, or decision.', 'learning', 30),
  ('learning-notes-refine', 'learning', 'Refine Your Understanding', 'Turn rough notes into a concise explanation of the ideas that matter most.', 'learning', 25),
  ('learning-question-set', 'learning', 'Build Better Questions', 'Write and answer three questions that test genuine understanding of your topic.', 'learning', 20),

  ('creativity-finished-piece', 'creativity', 'Finish One Creative Piece', 'Take one small creative work from its current state to a deliberate finish.', 'product_design', 30),
  ('creativity-constraint', 'creativity', 'Create Within a Constraint', 'Choose one useful constraint and produce something complete inside it.', 'product_design', 25),
  ('creativity-iterate', 'creativity', 'Improve One Existing Idea', 'Revisit an earlier idea and make one meaningful improvement to its execution.', 'product_design', 30),
  ('creativity-study-reference', 'creativity', 'Study a Strong Reference', 'Analyze one excellent creative reference and apply a lesson from it.', 'product_design', 25),
  ('creativity-experiment', 'creativity', 'Run a Focused Experiment', 'Test one creative technique or direction and preserve the useful result.', 'product_design', 25),
  ('creativity-remove-noise', 'creativity', 'Simplify the Work', 'Remove one unnecessary element so the central idea becomes stronger.', 'product_design', 20),

  ('finance-review-position', 'finance', 'Review Your Financial Position', 'Review the numbers that matter now and identify one responsible next action.', 'business', 20),
  ('finance-expense-audit', 'finance', 'Audit One Spending Category', 'Inspect one spending category and make one evidence-based adjustment.', 'business', 20),
  ('finance-plan-next', 'finance', 'Plan the Next Financial Move', 'Define one financial objective and the next concrete step toward it.', 'business', 20),
  ('finance-automate', 'finance', 'Strengthen a Financial System', 'Automate or simplify one recurring financial action to make consistency easier.', 'business', 25),
  ('finance-learn-decision', 'finance', 'Research One Financial Decision', 'Study one pending financial decision and record the risks, evidence, and next step.', 'business', 30),
  ('finance-progress-check', 'finance', 'Measure Financial Progress', 'Compare one current financial measure with its target and choose the next adjustment.', 'business', 20),

  ('relationships-present-conversation', 'relationships', 'Have a Present Conversation', 'Give one important conversation your full attention without multitasking.', 'communication', 20),
  ('relationships-reach-out', 'relationships', 'Reach Out With Intention', 'Contact someone important with a thoughtful message or meaningful question.', 'communication', 15),
  ('relationships-appreciation', 'relationships', 'Express Specific Appreciation', 'Tell someone exactly what you value about their effort, character, or support.', 'communication', 15),
  ('relationships-listen', 'relationships', 'Practice Better Listening', 'Ask one sincere question and listen to understand before responding.', 'communication', 20),
  ('relationships-repair', 'relationships', 'Resolve One Point of Friction', 'Address one small unresolved issue with clarity, respect, and ownership.', 'communication', 25),
  ('relationships-support', 'relationships', 'Offer Useful Support', 'Identify one practical way to support someone and follow through today.', 'communication', 20),

  ('mindset-honest-reflection', 'mindset', 'Reflect With Honesty', 'Write clearly about what is helping or limiting your current progress.', 'discipline', 15),
  ('mindset-reframe', 'mindset', 'Reframe One Limiting Thought', 'Challenge one unhelpful assumption and replace it with a more accurate perspective.', 'discipline', 15),
  ('mindset-control-focus', 'mindset', 'Focus on What You Control', 'Separate what you can control from what you cannot and act on one controllable step.', 'discipline', 20),
  ('mindset-standard', 'mindset', 'Define Today’s Standard', 'Choose one personal standard for today and complete the action that proves it.', 'discipline', 20),
  ('mindset-friction', 'mindset', 'Remove One Source of Friction', 'Change one part of your environment that makes disciplined action harder.', 'discipline', 20),
  ('mindset-review-response', 'mindset', 'Review Your Response', 'Examine one recent reaction and define how you want to respond next time.', 'discipline', 15),

  ('general-priority-session', 'general', 'Complete One Priority Session', 'Choose the most meaningful next action in your focus area and complete it.', 'problem_solving', 30),
  ('general-improve-system', 'general', 'Improve One System', 'Strengthen one repeatable process that supports progress in your chosen direction.', 'problem_solving', 25),
  ('general-remove-obstacle', 'general', 'Remove One Obstacle', 'Identify the clearest obstacle in front of you and reduce it with one concrete action.', 'problem_solving', 25),
  ('general-review-progress', 'general', 'Review and Adjust', 'Review recent progress, identify one weak point, and make a practical adjustment.', 'problem_solving', 20),
  ('general-finish-open-loop', 'general', 'Close One Open Loop', 'Finish one incomplete action that is consuming attention in your focus area.', 'problem_solving', 25),
  ('general-deliberate-practice', 'general', 'Practice With Intention', 'Complete one deliberate practice block aimed at a specific improvement.', 'problem_solving', 30);

-- One internal function owns canonical onboarding-focus normalization. Custom
-- values safely use the general catalog while preserving the user's saved
-- display focus in the selected mission snapshot.
create or replace function public.vault_mission_focus_key(p_focus text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case lower(trim(coalesce(p_focus, '')))
    when 'career' then 'career'
    when 'business' then 'business'
    when 'programming' then 'programming'
    when 'fitness' then 'fitness'
    when 'health' then 'health'
    when 'learning' then 'learning'
    when 'creativity' then 'creativity'
    when 'finance' then 'finance'
    when 'relationships' then 'relationships'
    when 'mindset' then 'mindset'
    else 'general'
  end;
$$;

revoke all on function public.vault_mission_focus_key(text)
from public, anon, authenticated;

-- Preserve a selected template identity in future authoritative history while
-- leaving every existing row valid. Null means the older identity cannot be
-- proven and is never fabricated.
alter table public.mission_history
  add column template_key text references public.mission_catalog(template_key);

comment on column public.mission_history.template_key
is 'Authoritative Sprint 15 mission template identity captured with the historical mission snapshot. Null for older rows when unprovable.';

create or replace function public.capture_vault_history_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_description text;
  v_original_state text;
  v_template_key text;
begin
  select
    state.mission_definition ->> 'description',
    state.lifecycle_state,
    state.mission_definition ->> 'templateKey'
  into v_description, v_original_state, v_template_key
  from public.daily_mission_state as state
  where state.user_id = new.user_id
    and state.mission_definition ->> 'id' = new.mission_id;

  if new.mission_description is null then
    new.mission_description := nullif(trim(v_description), '');
  end if;

  if new.original_state is null and v_original_state in ('ready', 'active') then
    new.original_state := v_original_state;
  end if;

  if new.template_key is null then
    new.template_key := nullif(trim(v_template_key), '');
  end if;

  return new;
end;
$$;

revoke all on function public.capture_vault_history_details()
from public, anon, authenticated;

-- Only exact current mission identities can safely reconcile an older row.
update public.mission_history as history
set template_key = nullif(trim(state.mission_definition ->> 'templateKey'), '')
from public.daily_mission_state as state
where history.user_id = state.user_id
  and history.mission_id = state.mission_definition ->> 'id'
  and history.template_key is null
  and state.mission_definition ? 'templateKey'
  and exists (
    select 1
    from public.mission_catalog as catalog
    where catalog.template_key = state.mission_definition ->> 'templateKey'
  );

-- Replace only the current internal builder. Daily creation and replacement
-- retain their existing zero-argument public RPCs, locks, logical-day identity,
-- effective staging clock, server UUID source, and lifecycle behavior.
create or replace function public.build_vault_daily_mission(
  p_onboarding public.onboarding_profiles,
  p_instance_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.dev_effective_vault_now();
  v_daily_key date;
  v_focus text := nullif(trim(p_onboarding.primary_focus), '');
  v_focus_key text;
  v_current_template_key text;
  v_template public.mission_catalog%rowtype;
  v_difficulty text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_instance_id is null then
    raise exception 'A server-generated mission instance is required' using errcode = '22023';
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);
  v_focus_key := public.vault_mission_focus_key(v_focus);

  select state.mission_definition ->> 'templateKey'
  into v_current_template_key
  from public.daily_mission_state as state
  where state.user_id = v_user_id
    and state.daily_key = v_daily_key;

  with usage_events as (
    select
      state.mission_definition ->> 'templateKey' as template_key,
      state.daily_key::timestamp as used_at
    from public.daily_mission_state as state
    where state.user_id = v_user_id
      and state.mission_definition ? 'templateKey'
    union all
    select history.template_key, history.terminal_at as used_at
    from public.mission_history as history
    where history.user_id = v_user_id
      and history.template_key is not null
  ), template_usage as (
    select events.template_key, max(events.used_at) as last_used_at
    from usage_events as events
    where events.template_key is not null
    group by events.template_key
  ), recent_templates as (
    select usage.template_key, usage.last_used_at
    from template_usage as usage
    order by usage.last_used_at desc, usage.template_key
    limit 5
  ), candidates as (
    select
      catalog.*,
      recent.last_used_at,
      count(*) over () as candidate_count
    from public.mission_catalog as catalog
    join public.skill_catalog as skill
      on skill.skill_key = catalog.primary_skill_key
     and skill.active = true
    left join recent_templates as recent
      on recent.template_key = catalog.template_key
    where catalog.focus_key = v_focus_key
      and catalog.active = true
  )
  select
    candidate.template_key,
    candidate.focus_key,
    candidate.title,
    candidate.description,
    candidate.primary_skill_key,
    candidate.estimated_minutes,
    candidate.active,
    candidate.created_at,
    candidate.updated_at
  into v_template
  from candidates as candidate
  order by
    case
      when candidate.template_key = v_current_template_key
       and candidate.candidate_count > 1 then 2
      when candidate.last_used_at is null then 0
      else 1
    end,
    candidate.last_used_at asc nulls first,
    pg_catalog.hashtextextended(
      v_user_id::text || ':' || v_daily_key::text || ':' || candidate.template_key,
      0
    ),
    candidate.template_key
  limit 1;

  if not found then
    raise exception 'No active authoritative mission template is available'
      using errcode = 'P0002';
  end if;

  v_difficulty := case lower(trim(p_onboarding.intensity))
    when 'focused' then 'Focused'
    when 'relentless' then 'Challenging'
    else 'Balanced'
  end;

  return jsonb_build_object(
    'id', v_template.template_key || '-' || p_instance_id::text,
    'templateKey', v_template.template_key,
    'focus', coalesce(v_focus, 'Personal Growth'),
    'title', v_template.title,
    'description', v_template.description,
    'estimatedDuration', v_template.estimated_minutes::text || ' minutes',
    'difficulty', v_difficulty,
    'xpReward', 25,
    'primarySkill', v_template.primary_skill_key
  );
end;
$$;

revoke all on function public.build_vault_daily_mission(public.onboarding_profiles, uuid)
from public, anon, authenticated;

comment on function public.build_vault_daily_mission(public.onboarding_profiles, uuid)
is 'Sprint 15 internal catalog selector. Uses auth.uid(), saved onboarding, the authoritative logical day, recent server history, canonical skills, and a server UUID; returns the fixed 25 XP reward.';

-- Reassert every relevant browser boundary. Catalog selection and historical
-- template attribution remain server-owned.
alter table public.mission_catalog enable row level security;
alter table public.mission_history enable row level security;
revoke all on public.mission_catalog from public, anon, authenticated;
revoke insert, update, delete on public.daily_mission_state from authenticated;
revoke insert, update, delete on public.mission_history from authenticated;
revoke insert, update, delete on public.skill_progression from authenticated;
revoke insert, update, delete on public.user_achievements from authenticated;
revoke insert, update, delete on public.user_streak_state from authenticated;
