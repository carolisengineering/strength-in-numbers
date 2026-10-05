import type fastifySwagger from "@fastify/swagger";
import { problemAwareTransform } from "./problem-responses.js";

/**
 * #10: publication in the anonymous `GET /openapi.json` is opt-in.
 *
 * `@fastify/swagger` lists every route unless it is hidden, so a route added
 * without `schema.hide` used to be published automatically ("forgot to hide").
 * Now only a route that sets `config.published: true` is documented; the
 * swagger `transform` hides everything else ("forgot to publish" is the safe
 * failure). `schema.hide` stays on the infra routes only as the opt-out from
 * the response-schema check (`assertRouteHasResponseSchema`).
 *
 * `assertPublication` runs in the root `onRoute` hook so a route that breaks
 * the invariant fails app assembly — in the server, the emit script and the
 * tests alike.
 */

declare module "fastify" {
  interface FastifyContextConfig {
    /** #10 — list this route in the public OpenAPI document. Only `/v1/…`
     * routes may set it, and a published route must also declare
     * `config.problems`. */
    published?: true;
  }
}

/** The parts of a Fastify `RouteOptions` this module reads. */
export interface PublicationRouteLike {
  method: string | readonly string[];
  url: string;
  schema?: { hide?: boolean };
  config?: { published?: boolean; swaggerTransform?: unknown };
}

export function isPublished(route: PublicationRouteLike): boolean {
  return route.config?.published === true;
}

export function assertPublication(route: PublicationRouteLike): void {
  const name = `${[route.method].flat().join(",")} ${route.url}`;
  // A per-route `swaggerTransform` replaces the global transform below, so it
  // would skip the publication gate entirely.
  if (route.config?.swaggerTransform !== undefined) {
    throw new Error(
      `Route ${name} sets config.swaggerTransform, which bypasses the OpenAPI publication gate (#10). ` +
        "Use `config.published` instead.",
    );
  }
  if (!isPublished(route)) return;
  if (!route.url.startsWith("/v1/")) {
    throw new Error(
      `Route ${name} sets config.published but is not under /v1/. The published document ` +
        "describes only the authenticated /v1 surface (#10).",
    );
  }
  if (route.schema?.hide === true) {
    throw new Error(`Route ${name} sets both config.published and schema.hide — pick one (#10).`);
  }
}

/** The swagger `transform`: published routes go through `problemAwareTransform`;
 * every other route is hidden. */
export const publicationTransform: fastifySwagger.SwaggerTransform = (input) => {
  if (!isPublished(input.route as unknown as PublicationRouteLike)) {
    return { schema: { ...input.schema, hide: true }, url: input.url };
  }
  return problemAwareTransform(input);
};
