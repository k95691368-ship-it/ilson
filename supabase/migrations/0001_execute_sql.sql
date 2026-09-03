create or replace function public.datetime(p_value text, p_modifier text default null)
returns text
language sql
as $$
  select to_char(
    coalesce(nullif(lower(p_value), 'now')::timestamp with time zone, timezone('UTC', now()))
    + coalesce((p_modifier)::interval, interval '0 second'),
    'YYYY-MM-DD HH24:MI:SS'
  )
$$;

create or replace function public.datetime(p_value timestamp with time zone, p_modifier text default null)
returns text
language sql
as $$
  select to_char(
    coalesce(p_value, timezone('UTC', now()))
    + coalesce((p_modifier)::interval, interval '0 second'),
    'YYYY-MM-DD HH24:MI:SS'
  )
$$;

create or replace function public.julianday(p_value text)
returns double precision
language sql
as $$
  select (extract(epoch from coalesce(
    (nullif(lower(p_value), 'now')::timestamp with time zone),
    timezone('UTC', now())
  )) / 86400.0 + 2440587.5)
$$;

create or replace function public.julianday(p_value timestamp with time zone)
returns double precision
language sql
as $$
  select (extract(epoch from p_value) / 86400.0 + 2440587.5)
$$;

create or replace function public.execute_sql(p_sql text, p_params jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_param jsonb;
  v_param_text text;
  v_idx integer;
  v_param_count integer;
  v_type text;
  v_rows jsonb := '[]'::jsonb;
  v_row_count bigint := 0;
  v_last_row_id bigint;
begin
  if p_params is null or jsonb_typeof(p_params) <> 'array' then
    p_params := '[]'::jsonb;
  end if;
  v_param_count := jsonb_array_length(p_params);

  for v_idx in 1..v_param_count loop
    v_param := p_params -> (v_idx - 1);
    if v_param is null or v_param = 'null' then
      v_param_text := 'NULL';
    elsif jsonb_typeof(v_param) in ('number', 'boolean') then
      v_param_text := v_param::text;
    elsif jsonb_typeof(v_param) in ('array', 'object') then
      v_param_text := quote_literal(v_param::text) || '::jsonb';
    else
      v_param_text := quote_literal(v_param::text);
    end if;

    v_sql := regexp_replace(v_sql, '\\?', v_param_text, 1, 1);
  end loop;

  v_type := lower(trim(regexp_replace(v_sql, '^\\s+', '')));
  if v_type like 'select%' or v_type like 'with%' then
    execute format('SELECT COALESCE(jsonb_agg(row_to_json(r)), ''[]''::jsonb) AS rows, COUNT(*) AS row_count FROM (%s) r', v_sql)
      into v_rows, v_row_count;
    return jsonb_build_object(
      'kind', 'rows',
      'rows', v_rows,
      'rowCount', v_row_count
    );
  end if;

  if v_type like 'insert%' and v_type not like '% returning %' then
    v_sql := v_sql || ' RETURNING id';
  end if;

  begin
    execute format('SELECT COALESCE(jsonb_agg(row_to_json(r)), ''[]''::jsonb) AS rows FROM (%s) r', v_sql)
      into v_rows;
    v_row_count := jsonb_array_length(coalesce(v_rows, '[]'::jsonb));
    v_last_row_id := null;
    if v_rows is not null and jsonb_typeof(v_rows) = 'array' and jsonb_array_length(v_rows) > 0 then
      v_last_row_id := nullif(v_rows->0->>'id', '')::bigint;
    end if;
    return jsonb_build_object(
      'kind', 'command',
      'rows', coalesce(v_rows, '[]'::jsonb),
      'rowCount', v_row_count,
      'last_row_id', v_last_row_id
    );
  exception when others then
    execute v_sql;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    return jsonb_build_object(
      'kind', 'command',
      'rows', '[]'::jsonb,
      'rowCount', v_row_count
    );
  end;
end;
$$;

