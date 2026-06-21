/* ============================================================
   PinkTileington — Export Module
   JSON atlas + ZIP archive export
   ============================================================ */

const Exporter = (() => {
  'use strict';

  // WHAT: Loading a base64 string into an HTML Image object asynchronously.
  // WHY: Canvas can't draw raw base64 strings directly. We must turn the string into an Image element and wait for the browser to decode it before drawing.
  function load_base64_data_url_into_image_element_asynchronously(base64_data_url_string) {
    return new Promise((resolve, reject) => {
      const temporary_image_element = new Image();
      temporary_image_element.onload = () => resolve(temporary_image_element);
      temporary_image_element.onerror = reject;
      temporary_image_element.src = base64_data_url_string;
    });
  }

  // WHAT: Generating a single combined sprite sheet canvas from an array of extraction sets,
  //       preserving the internal spatial layout of each set and stacking sets vertically.
  // WHY: Each extraction set represents a batch of tiles the user selected together. Their relative
  //       pixel positions must be maintained so multi-tile objects (buildings, terrain chunks) keep
  //       their shape on the exported spritesheet. New extractions are stacked below existing ones,
  //       growing the sheet vertically without overwriting anything. A blank tile at position (0,0)
  //       is standard because most tile engines treat index 0 as "empty / no tile".
  async function generate_combined_sprite_sheet_canvas(array_of_extraction_sets) {
    if (array_of_extraction_sets.length === 0) return null;

    // WHAT: Determining the blank tile dimensions from the first tile in the first set.
    // WHY: The blank tile at index 0 needs a defined size. We use the first real tile's dimensions
    //       as a reasonable default for the blank tile slot.
    const first_tile_in_first_set = array_of_extraction_sets[0].tiles[0];
    const blank_tile_slot_width = first_tile_in_first_set.tile_pixel_width;
    const blank_tile_slot_height = first_tile_in_first_set.tile_pixel_height;

    // WHAT: Computing the vertical stacking layout for all extraction sets.
    // WHY: We place each set one below the other, starting below the blank tile row. This ensures
    //       no sets overlap, and the sheet simply grows taller as more extractions are added.
    //       We track the widest element to determine the final canvas width.
    let current_vertical_cursor_y_pixels = blank_tile_slot_height;
    let maximum_sheet_width_pixels = blank_tile_slot_width;

    const array_of_set_placement_records = [];

    for (const current_extraction_set of array_of_extraction_sets) {
      array_of_set_placement_records.push({
        extraction_set_reference: current_extraction_set,
        placement_x_pixels: 0,
        placement_y_pixels: current_vertical_cursor_y_pixels,
      });

      current_vertical_cursor_y_pixels += current_extraction_set.bounding_height_pixels;
      maximum_sheet_width_pixels = Math.max(maximum_sheet_width_pixels, current_extraction_set.bounding_width_pixels);
    }

    const total_sheet_height_pixels = current_vertical_cursor_y_pixels;

    // WHAT: Creating the offscreen canvas sized to fit all extraction sets stacked vertically.
    // WHY: The canvas starts fully transparent by default, so the blank tile at (0,0) and any
    //       gaps within sets are automatically transparent.
    const combined_offscreen_canvas_element = document.createElement('canvas');
    combined_offscreen_canvas_element.width = maximum_sheet_width_pixels;
    combined_offscreen_canvas_element.height = total_sheet_height_pixels;
    const canvas_rendering_context = combined_offscreen_canvas_element.getContext('2d');

    // WHAT: Storing the layout metadata on the canvas element for later retrieval by the atlas builder.
    // WHY: The JSON atlas needs to know the spritesheet dimensions and that index 0 is the blank tile.
    combined_offscreen_canvas_element._spritesheet_layout_metadata = {
      sheet_pixel_width: maximum_sheet_width_pixels,
      sheet_pixel_height: total_sheet_height_pixels,
      blank_tile_index: 0,
    };

    // WHAT: Building a lookup map of tile_id → spritesheet coordinates as we paint tiles.
    // WHY: After building the spritesheet, the ZIP exporter needs to stamp the correct sheet_x
    //       and sheet_y values onto the flat tile array before building the atlas JSON.
    const tile_identifier_to_spritesheet_coordinates_map = new Map();

    // WHAT: Painting each extraction set at its stacked position, drawing each tile at its
    //       relative offset within the set.
    // WHY: The relative offsets were frozen at extraction time to preserve spatial relationships.
    //       Adding the set's placement offset positions the entire group correctly on the sheet.
    for (const current_placement_record of array_of_set_placement_records) {
      const current_set = current_placement_record.extraction_set_reference;

      for (const current_set_tile of current_set.tiles) {
        const absolute_sheet_x_pixels = current_placement_record.placement_x_pixels + current_set_tile.relative_x_within_set_pixels;
        const absolute_sheet_y_pixels = current_placement_record.placement_y_pixels + current_set_tile.relative_y_within_set_pixels;

        const loaded_html_image_element = await load_base64_data_url_into_image_element_asynchronously(current_set_tile.extracted_png_data_url);
        canvas_rendering_context.drawImage(loaded_html_image_element, absolute_sheet_x_pixels, absolute_sheet_y_pixels);

        // WHAT: Recording the absolute spritesheet coordinates for this tile.
        // WHY: If a tile appears in multiple sets, the last set's coordinates will win.
        //       This is acceptable because the tile's image data is identical across sets.
        tile_identifier_to_spritesheet_coordinates_map.set(current_set_tile.tile_identifier_string, {
          spritesheet_x_coordinate: absolute_sheet_x_pixels,
          spritesheet_y_coordinate: absolute_sheet_y_pixels,
        });
      }
    }

    // WHAT: Attaching the coordinate lookup map to the canvas for the ZIP exporter to consume.
    // WHY: The ZIP exporter needs to stamp these coordinates onto the flat tile array before
    //       building the atlas JSON so game engines know where to slice each tile from the sheet.
    combined_offscreen_canvas_element._tile_spritesheet_coordinates_map = tile_identifier_to_spritesheet_coordinates_map;

    return combined_offscreen_canvas_element;
  }

  // WHAT: Converting an HTML Canvas element into a binary File Blob asynchronously.
  // WHY: JSZip requires binary blobs to write files into the archive. The native canvas toBlob method requires a callback, so we wrap it in a Promise for cleaner async/await syntax.
  function convert_canvas_element_to_binary_blob_asynchronously(target_canvas_element) {
    return new Promise((resolve) => {
      target_canvas_element.toBlob((resulting_binary_blob) => {
        resolve(resulting_binary_blob);
      }, 'image/png');
    });
  }

  // WHAT: Constructing the master JSON configuration object that holds all tile data.
  // WHY: Game engines need a structured, predictable format to load sprite atlases. We compile all
  //       the grid math, collision data, and image strings into a single JSON tree. We use a flag
  //       to decide whether to embed the massive image strings directly in the JSON or just put
  //       file paths. The optional spritesheet_layout_metadata carries the grid dimensions and
  //       blank tile index from the spritesheet generator.
  function build_master_atlas_json_object(array_of_extracted_tiles, grid_configuration_settings, original_source_filename_string, should_embed_base64_images_boolean = true, spritesheet_layout_metadata = null) {
    // WHAT: Retrieving all collision data from the Collision module.
    // WHY: The collision module holds data independently of the tiles. We fetch a full dump so we can inject the relevant collision metadata into each tile's JSON block.
    const all_collision_metadata_object = Collision.exportAll();

    const master_atlas_json_structure = {
      meta: {
        tool: 'PinkTileington',
        version: '1.0.0',
        image: original_source_filename_string || 'unknown.png',
        grid: {
          cell_width_pixels: grid_configuration_settings.cell_width_pixels,
          cell_height_pixels: grid_configuration_settings.cell_height_pixels,
          shear_angle_x_radians: parseFloat(grid_configuration_settings.shear_angle_x_radians.toFixed(4)),
          shear_angle_y_radians: parseFloat(grid_configuration_settings.shear_angle_y_radians.toFixed(4)),
          grid_origin_offset_x_pixels: grid_configuration_settings.grid_origin_offset_x_pixels,
          grid_origin_offset_y_pixels: grid_configuration_settings.grid_origin_offset_y_pixels,
          total_grid_columns: grid_configuration_settings.total_grid_columns,
          total_grid_rows: grid_configuration_settings.total_grid_rows,
        },
        exportedAt: new Date().toISOString(),
        tileCount: array_of_extracted_tiles.length,
      },
    };

    // WHAT: Injecting spritesheet layout metadata into the meta block if it was provided.
    // WHY: When exporting a spritesheet (ZIP or GameMaker), the consuming engine needs to know
    //       the grid dimensions of the spritesheet and which index is the blank tile. For pure
    //       JSON exports (which embed images inline), this metadata is not relevant.
    if (spritesheet_layout_metadata) {
      master_atlas_json_structure.meta.spritesheet_columns = spritesheet_layout_metadata.spritesheet_total_columns;
      master_atlas_json_structure.meta.spritesheet_rows = spritesheet_layout_metadata.spritesheet_total_rows;
      master_atlas_json_structure.meta.blank_tile_index = spritesheet_layout_metadata.blank_tile_index;
    }

    // WHAT: Mapping our internal tile array into the formatted array expected by the export schema.
    // WHY: We iterate through every extracted tile, build its block, check if it has collision data, and append that data if it exists.
    master_atlas_json_structure.tiles = array_of_extracted_tiles.map(current_extracted_tile_object => {
        const single_tile_json_entry = {
          id: current_extracted_tile_object.tile_identifier_string,
          grid_x: current_extracted_tile_object.grid_column_index,
          grid_y: current_extracted_tile_object.grid_row_index,
          anchor_offset: current_extracted_tile_object.tile_anchor_point_x_y,
          width: current_extracted_tile_object.tile_pixel_width,
          height: current_extracted_tile_object.tile_pixel_height,
        };

        // WHAT: Embedding either the full image string or pointing to the combined sprite sheet coordinates.
        // WHY: For pure JSON, we embed the data. For a ZIP export, we link to the single generated spritesheet.png and provide the x, y coordinates so the game engine knows where to slice this specific tile out of the master sheet.
        if (should_embed_base64_images_boolean) {
          single_tile_json_entry.visual_data = current_extracted_tile_object.extracted_png_data_url;
        } else {
          single_tile_json_entry.file = 'spritesheet.png';
          if (current_extracted_tile_object.spritesheet_x_coordinate !== undefined) {
            single_tile_json_entry.sheet_x = current_extracted_tile_object.spritesheet_x_coordinate;
            single_tile_json_entry.sheet_y = current_extracted_tile_object.spritesheet_y_coordinate;
          }
        }

        const tile_collision_metadata = all_collision_metadata_object[current_extracted_tile_object.tile_identifier_string];
        
        // WHAT: Injecting collision properties if they exist for this tile.
        // WHY: We keep the keys as 'type', 'isWalkable', and 'polygon' because game engines reading this JSON expect these exact keys based on the schema documentation.
        if (tile_collision_metadata) {
          single_tile_json_entry.collision = {
            type: tile_collision_metadata.type,
            isWalkable: tile_collision_metadata.isWalkable,
          };
          if (tile_collision_metadata.polygon && tile_collision_metadata.polygon.length > 0) {
            single_tile_json_entry.collision.polygon = tile_collision_metadata.polygon;
          }
        }

        return single_tile_json_entry;
      });

    return master_atlas_json_structure;
  }

  // WHAT: Generating and triggering a download for a single JSON file.
  // WHY: The user requested a JSON export. We stringify our master atlas object into formatted text, turn that text into a File Blob, and force the browser to download it.
  function generate_and_download_standalone_json_file(array_of_extracted_tiles, grid_configuration_settings, original_source_filename_string) {
    const final_atlas_json_object = build_master_atlas_json_object(array_of_extracted_tiles, grid_configuration_settings, original_source_filename_string, true);
    
    // WHAT: Converting the JSON object into a formatted string with 2-space indentation.
    // WHY: Adding indentation makes the output file human-readable so developers can inspect it manually.
    const formatted_json_string_output = JSON.stringify(final_atlas_json_object, null, 2);
    
    const binary_blob_of_json_text = new Blob([formatted_json_string_output], { type: 'application/json' });
    trigger_browser_file_download_prompt(binary_blob_of_json_text, generate_dynamic_export_filename(original_source_filename_string, 'json'));
  }

  // WHAT: Generating a complete ZIP archive containing the JSON manifest and the combined spritesheet.
  // WHY: This is the preferred method for heavy projects, so game engines can load tiles from a
  //       single spritesheet image. We accept the extraction sets to build the spatially-aware
  //       spritesheet, then apply the resulting coordinates to the flat tile array before building
  //       the atlas JSON.
  async function generate_and_download_zip_archive_bundle(array_of_extracted_tiles, grid_configuration_settings, original_source_filename_string, array_of_extraction_sets) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library is not loaded. Cannot create ZIP archive.');
    }

    const jszip_archive_instance = new JSZip();

    // WHAT: Generating the combined sprite sheet canvas from the extraction sets.
    // WHY: The extraction sets contain the spatial layout data needed to position tiles correctly.
    //       The function returns a canvas with the tile coordinate lookup map attached to it.
    const combined_sprite_sheet_canvas = await generate_combined_sprite_sheet_canvas(array_of_extraction_sets);

    // WHAT: Applying the spritesheet coordinates from the lookup map onto the flat tile array.
    // WHY: The atlas JSON builder reads spritesheet_x_coordinate and spritesheet_y_coordinate
    //       from each tile object. Since the spritesheet was built from extraction sets (separate
    //       objects), we must transfer those coordinates to the flat tile objects used by the JSON.
    if (combined_sprite_sheet_canvas && combined_sprite_sheet_canvas._tile_spritesheet_coordinates_map) {
      const coordinates_lookup_map = combined_sprite_sheet_canvas._tile_spritesheet_coordinates_map;
      for (const current_flat_tile_object of array_of_extracted_tiles) {
        const resolved_coordinates = coordinates_lookup_map.get(current_flat_tile_object.tile_identifier_string);
        if (resolved_coordinates) {
          current_flat_tile_object.spritesheet_x_coordinate = resolved_coordinates.spritesheet_x_coordinate;
          current_flat_tile_object.spritesheet_y_coordinate = resolved_coordinates.spritesheet_y_coordinate;
        }
      }
    }

    // WHAT: Building the atlas JSON with spritesheet references instead of embedded images.
    // WHY: We want the JSON to contain "spritesheet.png" along with sheet_x and sheet_y
    //       coordinates so consuming engines know where to slice each tile from the master sheet.
    const spritesheet_layout_for_zip = combined_sprite_sheet_canvas ? combined_sprite_sheet_canvas._spritesheet_layout_metadata : null;
    const manifest_atlas_json_object = build_master_atlas_json_object(array_of_extracted_tiles, grid_configuration_settings, original_source_filename_string, false, spritesheet_layout_for_zip);
    jszip_archive_instance.file('atlas.json', JSON.stringify(manifest_atlas_json_object, null, 2));

    if (combined_sprite_sheet_canvas) {
      // WHAT: Converting the large sprite sheet canvas into a binary blob and saving it into the zip archive.
      // WHY: The zip library expects raw binary Blob data to create actual files.
      const sprite_sheet_binary_blob = await convert_canvas_element_to_binary_blob_asynchronously(combined_sprite_sheet_canvas);
      jszip_archive_instance.file('spritesheet.png', sprite_sheet_binary_blob);
    }

    // WHAT: Compiling the entire virtual archive into a single downloadable Blob asynchronously.
    // WHY: ZIP compression is mathematically heavy and takes time. Running it asynchronously ensures the browser UI doesn't completely freeze up while it crunches the numbers.
    const finalized_zip_archive_blob = await jszip_archive_instance.generateAsync({ type: 'blob' });
    trigger_browser_file_download_prompt(finalized_zip_archive_blob, generate_dynamic_export_filename(original_source_filename_string, 'zip'));
  }

  // WHAT: Creating a smart default filename based on the original image uploaded.
  // WHY: If the user uploaded "hero_sheet.png", the export should automatically be named "hero_sheet_atlas.zip" so they know what it is.
  function generate_dynamic_export_filename(original_source_filename_string, target_file_extension_string) {
    const base_filename_without_extension = original_source_filename_string
      ? original_source_filename_string.replace(/\.[^.]+$/, '')
      : 'pinktileington_atlas';
    return `${base_filename_without_extension}_atlas.${target_file_extension_string}`;
  }

  // WHAT: A hack to force the browser to download a generated Blob as a file.
  // WHY: Browsers do not have a standard 'download(blob)' javascript function. We have to create a hidden <a> link element, point its URL to our blob, programmatically click the link, and then destroy the link so it leaves no trace.
  function trigger_browser_file_download_prompt(binary_blob_to_download, desired_filename_string) {
    const temporary_object_url_string = URL.createObjectURL(binary_blob_to_download);
    const hidden_download_anchor_element = document.createElement('a');
    hidden_download_anchor_element.href = temporary_object_url_string;
    hidden_download_anchor_element.download = desired_filename_string;
    
    document.body.appendChild(hidden_download_anchor_element);
    hidden_download_anchor_element.click();
    document.body.removeChild(hidden_download_anchor_element);
    
    // WHAT: Revoking the object URL after a short delay.
    // WHY: If we don't revoke it, the browser keeps the massive binary blob in memory forever, causing a memory leak. We wait 1 second just to make sure the download actually started before deleting it from memory.
    setTimeout(() => URL.revokeObjectURL(temporary_object_url_string), 1000);
  }

  // WHAT: Constructing the massive JSON configuration object required for a GameMaker sprite (.yy) file.
  // WHY: GameMaker relies on a very specific schema to parse sprites. We auto-fill the bounding box (bbox) and origin (xorigin/yorigin) so the sprite drops perfectly into the engine.
  function build_gamemaker_sprite_yy(tile_object, base_name) {
    const sprite_name = `spr_${base_name}_${tile_object.tile_identifier_string}`;
    return {
      "resourceType": "GMSprite",
      "resourceVersion": "2.0",
      "name": sprite_name,
      "bbox_bottom": tile_object.tile_footprint_bounding_box.bottom,
      "bbox_left": tile_object.tile_footprint_bounding_box.left,
      "bbox_right": tile_object.tile_footprint_bounding_box.right,
      "bbox_top": tile_object.tile_footprint_bounding_box.top,
      "bboxMode": 2,
      "collisionKind": 1,
      "collisionTolerance": 0,
      "DynamicTexturePage": false,
      "edgeFiltering": false,
      "For3D": false,
      "frames": [
        {
          "resourceType": "GMSpriteFrame",
          "resourceVersion": "2.0",
          "name": tile_object.tile_identifier_string,
        }
      ],
      "gridX": 0,
      "gridY": 0,
      "height": tile_object.tile_pixel_height,
      "HTile": false,
      "layers": [
        {
          "resourceType": "GMImageLayer",
          "resourceVersion": "2.0",
          "name": "default",
          "blendMode": 0,
          "displayName": "default",
          "isLocked": false,
          "opacity": 100.0,
          "visible": true,
        }
      ],
      "origin": 9,
      "parent": {
        "name": "Sprites",
        "path": "folders/Sprites.yy"
      },
      "preMultiplyAlpha": false,
      "sequence": {
        "resourceType": "GMSequence",
        "resourceVersion": "2.0",
        "name": sprite_name,
        "autoRecord": true,
        "backdropHeight": 768,
        "backdropImageOpacity": 0.5,
        "backdropImagePath": "",
        "backdropWidth": 1366,
        "backdropXOffset": 0.0,
        "backdropYOffset": 0.0,
        "events": {
          "resourceType": "KeyframeStore<MessageEventKeyframe>",
          "resourceVersion": "2.0",
          "Keyframes": []
        },
        "eventStubScript": null,
        "eventToFunction": {},
        "length": 1.0,
        "lockOrigin": false,
        "moments": {
          "resourceType": "KeyframeStore<MomentsEventKeyframe>",
          "resourceVersion": "2.0",
          "Keyframes": []
        },
        "playback": 1,
        "playbackSpeed": 30.0,
        "playbackSpeedType": 0,
        "showBackdrop": true,
        "showBackdropImage": false,
        "timeUnits": 1,
        "tracks": [
          {
            "resourceType": "GMSpriteFramesTrack",
            "resourceVersion": "2.0",
            "name": "frames",
            "builtinName": 0,
            "events": [],
            "inheritsTrackColour": true,
            "interpolation": 1,
            "isCreationTrack": false,
            "keyframes": {
              "resourceType": "KeyframeStore<SpriteFrameKeyframe>",
              "resourceVersion": "2.0",
              "Keyframes": [
                {
                  "resourceType": "Keyframe<SpriteFrameKeyframe>",
                  "resourceVersion": "2.0",
                  "Channels": {
                    "0": {
                      "resourceType": "SpriteFrameKeyframe",
                      "resourceVersion": "2.0",
                      "Id": {
                        "name": tile_object.tile_identifier_string,
                        "path": `sprites/${sprite_name}/${sprite_name}.yy`
                      }
                    }
                  },
                  "Disabled": false,
                  "id": tile_object.tile_identifier_string + "-frame",
                  "IsCreationKey": false,
                  "Key": 0.0,
                  "Length": 1.0,
                  "Stretch": false
                }
              ]
            },
            "modifiers": [],
            "spriteId": null,
            "trackColour": 0,
            "tracks": [],
            "traits": 0
          }
        ],
        "visibleRange": null,
        "volume": 1.0,
        "xorigin": tile_object.tile_anchor_point_x_y.x_coordinate,
        "yorigin": tile_object.tile_anchor_point_x_y.y_coordinate
      },
      "swatchColours": null,
      "swfPrecision": 2.525,
      "textureGroupId": {
        "name": "Default",
        "path": "texturegroups/Default"
      },
      "type": 0,
      "VTile": false,
      "width": tile_object.tile_pixel_width
    };
  }

  // WHAT: Generating a ZIP archive specifically formatted as a GameMaker project folder snippet.
  // WHY: GameMaker requires each sprite to be in its own subfolder containing the .yy file and the .png image file named as the frame UUID.
  async function generate_and_download_gamemaker_archive(array_of_extracted_tiles, grid_configuration_settings, original_source_filename_string) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library is not loaded. Cannot create ZIP archive.');
    }

    const jszip_archive_instance = new JSZip();
    const base_name = original_source_filename_string
      ? original_source_filename_string.replace(/\.[^.]+$/, '')
      : 'pinktileington';

    // WHAT: Creating the 'sprites' directory where GameMaker expects sprites to live.
    // WHY: Structuring it this way allows the user to drag the 'sprites' folder directly into their GameMaker project folder.
    const sprites_folder = jszip_archive_instance.folder('sprites');

    for (const current_extracted_tile_object of array_of_extracted_tiles) {
      const sprite_name = `spr_${base_name}_${current_extracted_tile_object.tile_identifier_string}`;
      const sprite_subfolder = sprites_folder.folder(sprite_name);

      // WHAT: Building and writing the .yy JSON file for the sprite.
      const sprite_yy_object = build_gamemaker_sprite_yy(current_extracted_tile_object, base_name);
      sprite_subfolder.file(`${sprite_name}.yy`, JSON.stringify(sprite_yy_object, null, 2));

      // WHAT: Saving the PNG using the frame ID.
      // WHY: GameMaker links the image layer in the .yy file using the frame UUID, so the actual .png file must be named with that UUID.
      const decoded_binary_png_blob = Extractor.dataUrlToBlob(current_extracted_tile_object.extracted_png_data_url);
      sprite_subfolder.file(`${current_extracted_tile_object.tile_identifier_string}.png`, decoded_binary_png_blob);
    }

    // WHAT: Including the original JSON atlas as a supplementary file with layout metadata.
    // WHY: The .yy files cover origin and bounding box, but if the user defined custom polygonal
    //       collisions or extra metadata in PinkTileington, they might still want the raw atlas
    //       data to parse at runtime. We don't have a spritesheet canvas here (GameMaker uses
    //       individual PNGs), but we still pass null so the function signature is satisfied.
    const manifest_atlas_json_object = build_master_atlas_json_object(array_of_extracted_tiles, grid_configuration_settings, original_source_filename_string, false, null);
    jszip_archive_instance.file(`${base_name}_atlas_data.json`, JSON.stringify(manifest_atlas_json_object, null, 2));

    const finalized_zip_archive_blob = await jszip_archive_instance.generateAsync({ type: 'blob' });
    trigger_browser_file_download_prompt(finalized_zip_archive_blob, generate_dynamic_export_filename(original_source_filename_string, 'gamemaker_export.zip'));
  }

  return {
    buildAtlas: build_master_atlas_json_object,
    downloadJSON: generate_and_download_standalone_json_file,
    downloadZIP: generate_and_download_zip_archive_bundle,
    downloadGameMaker: generate_and_download_gamemaker_archive,
  };
})();
