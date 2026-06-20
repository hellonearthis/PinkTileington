/* ============================================================
   PinkTileington — Export Module
   JSON atlas + ZIP archive export
   ============================================================ */

const Exporter = (() => {
  'use strict';

  // WHAT: Constructing the master JSON configuration object that holds all tile data.
  // WHY: Game engines need a structured, predictable format to load sprite atlases. We compile all the grid math, collision data, and image strings into a single JSON tree. We use a flag to decide whether to embed the massive image strings directly in the JSON or just put file paths.
  function build_master_atlas_json_object(array_of_extracted_tiles, grid_configuration_settings, original_source_filename_string, should_embed_base64_images_boolean = true) {
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
      // WHAT: Mapping our internal tile array into the formatted array expected by the export schema.
      // WHY: We iterate through every extracted tile, build its block, check if it has collision data, and append that data if it exists.
      tiles: array_of_extracted_tiles.map(current_extracted_tile_object => {
        const single_tile_json_entry = {
          id: current_extracted_tile_object.tile_identifier_string,
          grid_x: current_extracted_tile_object.grid_column_index,
          grid_y: current_extracted_tile_object.grid_row_index,
          anchor_offset: current_extracted_tile_object.tile_anchor_point_x_y,
          width: current_extracted_tile_object.tile_pixel_width,
          height: current_extracted_tile_object.tile_pixel_height,
        };

        // WHAT: Embedding either the full image string or a relative file path.
        // WHY: For a pure JSON export, the user wants the image data embedded. For a ZIP export, embedding thousands of images into one JSON file would crash it, so we just provide the relative path to the PNG files inside the ZIP.
        if (should_embed_base64_images_boolean) {
          single_tile_json_entry.visual_data = current_extracted_tile_object.extracted_png_data_url;
        } else {
          single_tile_json_entry.file = `tiles/${current_extracted_tile_object.tile_identifier_string}.png`;
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
      }),
    };

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

  // WHAT: Generating a complete ZIP archive containing the JSON manifest and a folder full of PNG images.
  // WHY: This is the preferred method for heavy projects, so game engines can load the PNG files individually without trying to parse a multi-megabyte text file. We use the external JSZip library to construct the archive in browser memory.
  async function generate_and_download_zip_archive_bundle(array_of_extracted_tiles, grid_configuration_settings, original_source_filename_string) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library is not loaded. Cannot create ZIP archive.');
    }

    const jszip_archive_instance = new JSZip();

    // WHAT: Building the atlas JSON but passing 'false' for the embed flag.
    // WHY: We want the JSON to contain relative paths like "tiles/tile_0_1.png", not massive Base64 strings.
    const manifest_atlas_json_object = build_master_atlas_json_object(array_of_extracted_tiles, grid_configuration_settings, original_source_filename_string, false);
    jszip_archive_instance.file('atlas.json', JSON.stringify(manifest_atlas_json_object, null, 2));

    // WHAT: Creating a virtual "tiles" folder inside the zip archive.
    // WHY: This keeps the root directory of the zip clean and organized.
    const virtual_tiles_directory_folder = jszip_archive_instance.folder('tiles');
    
    // WHAT: Looping through every extracted tile, converting its Base64 string back into binary PNG data, and saving it into the virtual folder.
    // WHY: The zip library expects raw binary Blob data to create actual files, so we call our Extractor helper function to decode the text.
    for (const current_extracted_tile_object of array_of_extracted_tiles) {
      const decoded_binary_png_blob = Extractor.dataUrlToBlob(current_extracted_tile_object.extracted_png_data_url);
      virtual_tiles_directory_folder.file(`${current_extracted_tile_object.tile_identifier_string}.png`, decoded_binary_png_blob);
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

  return {
    buildAtlas: build_master_atlas_json_object,
    downloadJSON: generate_and_download_standalone_json_file,
    downloadZIP: generate_and_download_zip_archive_bundle,
  };
})();
