-- Vista previa antes de pagar (replica/competencia.md): la imagen de referencia de un texto se guarda como una subida más,
-- marcada como 'preview' para poder contarla en el tope diario. Si el usuario la aprueba, el modelo sale de ella (image_to_model).
alter table uploads add column source text not null default 'user' check (source in ('user', 'preview'));
create index uploads_preview_day_idx on uploads (user_id, created_at) where source = 'preview';
