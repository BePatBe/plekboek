/**
 * OAuth-client-ID uit Google Cloud Console (type "Webapplicatie").
 * Dit is geen geheim: het staat in elke web-app die met Google inlogt. Toegang wordt beperkt
 * door de "geautoriseerde JavaScript-oorsprongen" die bij de client in Google Cloud zijn ingesteld.
 * Leeg = de Google Drive-optie toont dat ze nog niet is ingesteld.
 */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
