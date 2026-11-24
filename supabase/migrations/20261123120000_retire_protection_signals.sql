-- Ritira Segnale Tutela anche per le vecchie versioni dell'app.
-- Non cancellare i dati storici né modificare il normale flusso SOS.
revoke all on function public.create_protection_signal(text,text,text,text,text,text,text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.get_protection_area_alert(text,text)
  from public, anon, authenticated;
revoke all on function public.list_protection_area_alerts(text)
  from public, anon, authenticated;
