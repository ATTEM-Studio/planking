insert into public.organizations (name, slug)
values ('그리온', 'grion')
on conflict (slug) do nothing;
