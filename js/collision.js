/* ============================================================
   PinkTileington — Collision Metadata Manager
   Per-tile collision type, walkability, and polygon data
   ============================================================ */

const Collision = (() => {
  'use strict';

  // WHAT: A central, in-memory dictionary (Map) to store collision data.
  // WHY: We need a fast, reliable place to store and retrieve metadata about whether a player can walk on a specific tile. By using a Map keyed by the unique tile identifier string, lookups are extremely fast.
  const central_collision_data_store_map = new Map();

  const VALID_COLLISION_TYPES_ARRAY = ['none', 'wall', 'water', 'hazard', 'custom'];

  // WHAT: Generating the default, blank-slate collision properties for a tile.
  // WHY: If a user clicks on a tile they haven't edited yet, we shouldn't crash trying to read missing data. We return a safe default where the tile is just standard, walkable ground with no special collision walls.
  // Note: We keep the object keys exactly as 'type', 'isWalkable', and 'polygon' because these exactly match the exported JSON schema expected by GameMaker.
  function generate_default_collision_data_object() {
    return {
      type: 'none',
      isWalkable: true,
      polygon: [],
    };
  }

  // WHAT: Retrieving the collision data for a specific tile.
  // WHY: Whenever the UI needs to update the sidebar, or the exporter needs to build the JSON atlas, they call this to get the data. If the tile has never been edited, we safely initialize it with the defaults first.
  function retrieve_collision_data_for_tile(target_tile_identifier_string) {
    if (!central_collision_data_store_map.has(target_tile_identifier_string)) {
      central_collision_data_store_map.set(target_tile_identifier_string, generate_default_collision_data_object());
    }
    return central_collision_data_store_map.get(target_tile_identifier_string);
  }

  // WHAT: Updating specific collision properties for a tile without deleting the rest.
  // WHY: A user might just want to toggle "walkable" off without clearing their custom polygon. We retrieve the existing data and merge the new updates into it using the spread operator.
  function update_collision_data_for_tile(target_tile_identifier_string, new_collision_properties_object) {
    const existing_collision_data_object = retrieve_collision_data_for_tile(target_tile_identifier_string);
    central_collision_data_store_map.set(target_tile_identifier_string, { ...existing_collision_data_object, ...new_collision_properties_object });
  }

  // WHAT: Setting the collision "type" (e.g., wall, water) and automatically guessing the walkability.
  // WHY: It's tedious for users to set "Type: Wall" and then manually uncheck "Walkable". We do a smart default: if it's "none", it's walkable. Anything else is blocked by default.
  function set_specific_collision_type(target_tile_identifier_string, desired_collision_type_string) {
    const is_tile_currently_walkable_boolean = (desired_collision_type_string === 'none');
    update_collision_data_for_tile(target_tile_identifier_string, { type: desired_collision_type_string, isWalkable: is_tile_currently_walkable_boolean });
  }

  // WHAT: Flipping the walkable status of a tile from true to false, or false to true.
  // WHY: Used by a toggle switch in the UI. We fetch the current boolean value and just invert it with the NOT (!) operator.
  function toggle_tile_walkability_boolean(target_tile_identifier_string) {
    const current_collision_data_object = retrieve_collision_data_for_tile(target_tile_identifier_string);
    update_collision_data_for_tile(target_tile_identifier_string, { isWalkable: !current_collision_data_object.isWalkable });
  }

  // WHAT: Saving a custom array of pixel points to define a complex collision boundary.
  // WHY: For games that need precise geometry instead of full-cell blocking, users can define polygons. We copy the array to prevent accidental mutations elsewhere.
  function save_custom_collision_polygon_array(target_tile_identifier_string, array_of_polygon_vertex_points) {
    update_collision_data_for_tile(target_tile_identifier_string, { polygon: [...array_of_polygon_vertex_points] });
  }

  // WHAT: Deleting a custom collision boundary.
  // WHY: If a user makes a mistake and wants to revert a tile back to simple block collision, we clear the array.
  function clear_custom_collision_polygon_array(target_tile_identifier_string) {
    update_collision_data_for_tile(target_tile_identifier_string, { polygon: [] });
  }

  // WHAT: Wiping the entire database of all collision data.
  // WHY: When the user imports a fresh new JSON atlas, we must destroy all the old data from the previous session to avoid "ghost" tiles persisting.
  function clear_entire_collision_database() {
    central_collision_data_store_map.clear();
  }

  // WHAT: Packaging the entire Map dictionary into a standard, plain JavaScript object.
  // WHY: JavaScript Maps cannot be directly converted to JSON by the standard JSON.stringify() function. We have to manually iterate through the Map and copy the keys and values into a standard object so the exporter can save it.
  function export_all_collision_data_as_plain_object() {
    const plain_javascript_output_object = {};
    for (const [current_tile_identifier_string, current_collision_data_object] of central_collision_data_store_map) {
      plain_javascript_output_object[current_tile_identifier_string] = { ...current_collision_data_object };
    }
    return plain_javascript_output_object;
  }

  // WHAT: Rebuilding the internal Map database from a plain JavaScript object.
  // WHY: When a user imports a JSON atlas file, it gives us a plain object. We have to clear our Map and manually insert all the imported records back into it.
  function import_all_collision_data_from_plain_object(imported_plain_javascript_object) {
    central_collision_data_store_map.clear();
    for (const [imported_tile_identifier_string, imported_collision_data_object] of Object.entries(imported_plain_javascript_object)) {
      central_collision_data_store_map.set(imported_tile_identifier_string, { ...generate_default_collision_data_object(), ...imported_collision_data_object });
    }
  }

  // WHAT: Checking if a tile has actually been modified by the user.
  // WHY: If a tile is just standard, default walkable ground, we don't necessarily need to draw warning markers over it in the UI. This tells the Canvas whether it needs to render a "Walkable: No" indicator.
  function does_tile_have_custom_collision_data(target_tile_identifier_string) {
    if (!central_collision_data_store_map.has(target_tile_identifier_string)) {
      return false;
    }
    
    const current_collision_data_object = central_collision_data_store_map.get(target_tile_identifier_string);
    
    // Check if the type is changed, or walkability is off, or if there is a custom polygon.
    return (current_collision_data_object.type !== 'none' || current_collision_data_object.isWalkable === false || current_collision_data_object.polygon.length > 0);
  }

  return {
    TYPES: VALID_COLLISION_TYPES_ARRAY,
    get: retrieve_collision_data_for_tile,
    set: update_collision_data_for_tile,
    setType: set_specific_collision_type,
    toggleWalkable: toggle_tile_walkability_boolean,
    setPolygon: save_custom_collision_polygon_array,
    clearPolygon: clear_custom_collision_polygon_array,
    clear: clear_entire_collision_database,
    exportAll: export_all_collision_data_as_plain_object,
    importAll: import_all_collision_data_from_plain_object,
    hasData: does_tile_have_custom_collision_data,
  };
})();
