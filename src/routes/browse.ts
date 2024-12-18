import { Request, Response } from "express";
import { stringify as stringifyQuery } from "qs";

import { Links } from "../@types/StacCatalog";

import { getCollections } from "../domains/collections";
import { buildQuery } from "../domains/stac";
import { ItemNotFound } from "../models/errors";
import { getBaseUrl, mergeMaybe, stacContext } from "../utils";
import { STACCollection } from "../@types/StacCollection";

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
  req.params.searchType = "collection";
  const query = await buildQuery(req);

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
    addItemLinkIfPresent(collection, `${getBaseUrl(self)}/${encodeURIComponent(collection.id)}`);
  });

  const links = collectionLinks(req, cursor);

  const collectionsResponse = {
    description: `All collections provided by ${self.split("/").at(-2)}`,
    links,
    collections,
  };

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
  addItemLinkIfPresent(collection, path);
  res.json(collection);
};

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

export function addItemLinkIfPresent(collection: STACCollection, url: string) {
  const itemsLink = collection.links.find((link) => link.rel === "items");

  if (!itemsLink) {
    collection.links.push({
      rel: "items",
      href: `${url}/items`,
      type: "application/geo+json",
      title: "Collection Items",
    });
  }
}
