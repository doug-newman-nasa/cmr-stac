import { Request, Response } from "express";

import { Links } from "../@types/StacCatalog";

import { getCollections } from "../domains/collections";
import { buildQuery, stringifyQuery } from "../domains/stac";
import { ItemNotFound } from "../models/errors";
import { getBaseUrl, mergeMaybe, stacContext } from "../utils";
import { STACCollection } from "../@types/StacCollection";
import { ALL_PROVIDER } from "./rootCatalog";

const collectionLinks = (req: Request, nextCursor?: string | null): Links => {
  const { stacRoot, self } = stacContext(req);

  const parent = self.split("/").slice(0, -1).join("/");

  const links = [
    {
      rel: "self",
      href: self,
      type: "application/json",
    },
    {
      rel: "root",
      href: stacRoot,
      type: "application/json",
      title: `Root Catalog`,
    },
    {
      rel: "parent",
      href: parent,
      type: "application/json",
      title: "Provider Collections",
    },
  ];

  const originalQuery = mergeMaybe(req.query, req.body);

  if (nextCursor) {
    const nextResultsQuery = { ...originalQuery, cursor: nextCursor };

    links.push({
      rel: "next",
      href: `${stacRoot}${req.path}?${stringifyQuery(nextResultsQuery)}`,
      type: "application/geo+json",
    });
  }
  return links;
};

export const collectionsHandler = async (req: Request, res: Response): Promise<void> => {
  const { headers } = req;

  const query = await buildQuery(req);

  // If the query contains a "provider": "ALL" clause, we need to remove it as
  // this is a 'special' provider that means 'all providers'. The absence
  // of a provider clause gives the right query.
  if ("provider" in query) {
    if (query.provider == ALL_PROVIDER) {
      delete query.provider;
    }
  }

  const { cursor, items: collections } = await getCollections(query, {
    headers,
  });

  const { stacRoot, self } = stacContext(req);

  collections.forEach((collection) => {
    collection.links.push({
      rel: "self",
      href: `${getBaseUrl(self)}/${encodeURIComponent(collection.id)}`,
      type: "application/json",
    });
    collection.links.push({
      rel: "root",
      href: encodeURI(stacRoot),
      type: "application/json",
    });
    
    const baseUrl = generateBaseUrlForCollection(getBaseUrl(self), collection);
    console.log("collectionsHandler: URL: " + baseUrl);
    addItemLinkIfNotPresent(collection, `${baseUrl}/${encodeURIComponent(collection.id)}/items`);
  });

  const links = collectionLinks(req, cursor);
  
  const collectionsResponse = generateCollectionResponse(self, links, collections);

  res.json(collectionsResponse);
};

/**
 * Returns a STACCollection as the body.
 */
export const collectionHandler = async (req: Request, res: Response): Promise<void> => {
  const {
    collection,
    params: { collectionId, providerId },
  } = req;

  if (!collection) {
    throw new ItemNotFound(
      `Could not find collection [${collectionId}] in provider [${providerId}]`
    );
  }

  collection.links = collection.links
    ? [...collectionLinks(req), ...(collection.links ?? [])]
    : [...collectionLinks(req)];
  const { path } = stacContext(req);
  console.debug("collectionHandler: URL: " + path);
  addItemLinkIfNotPresent(collection, `${path}/items`);
  res.json(collection);
};

/**
 * Marshall the description, links and collections into a valid response
 * This catalog may be 'ALL'. If so, we need to override the description
 * property to convey that this results represents all of CMR
 * 
 * @param self the base url
 * @param links the urls associated with this response
 * @param collections the STAC collection object that contains the provider of the collection
 * 
 */

export function generateCollectionResponse(self: string, links: Links, collections: STACCollection[]): { description: string; links: Links; collections: STACCollection[]; } {
  // Special case. If provider is 'ALL' use descirpion of 'provided by CMR'
  let provider = self.split("/").at(-2)
  if (provider == ALL_PROVIDER) {
    provider = "CMR";
  }
  const collectionsResponse = {
    description: `All collections provided by ${provider}`,
    links,
    collections,
  };
  return collectionsResponse;
}

/**
 * This catalog may be 'ALL' but the link to the collection's items must reference
 * the catalog associated with the collection's provider
 * 
 * @param self the context of the STAC urls
 * @param collection the STAC collection object that contains the provider of the collection
 */

export function generateBaseUrlForCollection(baseUrl: string, collection: STACCollection): string {
  // Extract the actual provider of the collection
  const provider = collection.providers.find((p) => p.roles?.includes("producer"));
  // Construct the items url from that provider
  if (provider) baseUrl = baseUrl.replace("/ALL/", `/${provider.name}/`);
  return baseUrl;
}

/**
 * A CMR collection can now indicate to consumers that it has a STAC API.
 * If that is the case then we use that link instead of a generic CMR one.
 * This is useful of collections that do not index their granule
 * metadata in CMR, like CWIC collection.
 * If the list of links of does not contain a link of type 'items' then
 * add the default items element
 *
 *  @param collection the STAC collection object containing links
 *  @param url the generic link to a CMR STAC API
 */

export function addItemLinkIfNotPresent(collection: STACCollection, url: string) {
  console.debug("addItemLinkIfNotPresent URL: " + url)
  const itemsLink = collection.links.find((link) => link.rel === "items");

  if (!itemsLink) {
    collection.links.push({
      rel: "items",
      href: url,
      type: "application/geo+json",
      title: "Collection Items",
    });
  }
}
