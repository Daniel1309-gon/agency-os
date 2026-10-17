-- Las series recurrentes crean la siguiente ocurrencia desde el worker: al
-- encolar la actual inserta una fila PENDING nueva en scheduled_messages. Los
-- grants de 0008 solo daban SELECT y UPDATE sobre esa tabla, así que sin este
-- INSERT el job falla con 42501 y la serie se detiene en silencio.
GRANT INSERT ON TABLE scheduled_messages TO agency_worker;
