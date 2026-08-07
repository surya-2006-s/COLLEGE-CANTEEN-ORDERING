/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4198167069")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" || @request.auth.id = \"\"",
    "listRule": "@request.auth.id != \"\" || @request.auth.id = \"\"",
    "updateRule": "@request.auth.id != \"\" || @request.auth.id = \"\"",
    "viewRule": "@request.auth.id != \"\" || @request.auth.id = \"\""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4198167069")

  // update collection data
  unmarshal({
    "createRule": null,
    "listRule": null,
    "updateRule": null,
    "viewRule": null
  }, collection)

  return app.save(collection)
})
