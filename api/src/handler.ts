import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { buildInsights } from "./insights/buildInsights";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const bundle = body.bundle;

    if (!bundle || bundle.resourceType !== "Bundle") {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "bundle (FHIR Bundle) is required" }),
      };
    }

    const dto = buildInsights(bundle, { includeResources: true });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dto),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e?.message ?? "server error" }),
    };
  }
};
