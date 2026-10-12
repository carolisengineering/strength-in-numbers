/**
 * The HTTP methods the API allows cross-origin (the browser's CORS preflight).
 * The single list `@fastify/cors` is configured from. A method missing here is
 * refused by the browser before the request is sent, which the SPA can only
 * report as a network failure ("You're offline") — the 2026-10-11 routine-edit
 * bug, where `PUT /v1/routines/{id}` was missing.
 */
export const CORS_METHODS: readonly string[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
