/* ============================================================
   PinkTileington — Tile Extractor Module
   Extract parallelogram tiles via canvas clipping paths
   ============================================================ */

const Extractor = (() => {
  'use strict';

  // WHAT: Creating global variables to hold a persistent offscreen canvas.
  // WHY: We don't want to create a brand new HTML canvas element every single time we extract a tile, because creating elements is slow. We create one hidden canvas and reuse it to optimize performance.
  let persistent_offscreen_canvas_element = null;
  let persistent_offscreen_canvas_rendering_context = null;

  // WHAT: Getting or creating our persistent offscreen canvas and resizing it to the requested dimensions.
  // WHY: Before we can draw and extract a tile, we need a clean slate of the exact right size. This function ensures the canvas exists, clears any old pixel data from previous extractions, and sets the width/height to match the incoming tile bounds.
  function retrieve_and_prepare_offscreen_canvas(target_width_pixels, target_height_pixels) {
    if (!persistent_offscreen_canvas_element) {
      persistent_offscreen_canvas_element = document.createElement('canvas');
      persistent_offscreen_canvas_rendering_context = persistent_offscreen_canvas_element.getContext('2d');
    }
    persistent_offscreen_canvas_element.width = target_width_pixels;
    persistent_offscreen_canvas_element.height = target_height_pixels;
    persistent_offscreen_canvas_rendering_context.clearRect(0, 0, target_width_pixels, target_height_pixels);
    
    return { 
      canvas_element: persistent_offscreen_canvas_element, 
      rendering_context: persistent_offscreen_canvas_rendering_context 
    };
  }

  // WHAT: Extracting a single tile's pixel data from the main source image using a clipping path.
  // WHY: The tiles in the source image are oblique parallelograms, not neat rectangles. If we just cropped a rectangle, we'd grab parts of neighboring tiles. By drawing the source image through a parallelogram-shaped "stencil" (clipping path), we isolate the exact tile while leaving the background completely transparent.
  function perform_single_tile_extraction(source_spritesheet_image, grid_column_index, grid_row_index, grid_configuration_settings) {
    // WHAT: Asking the math module for the exact 4 pixel coordinates that define the corners of this tile.
    // WHY: These four points are our stencil. We need them to create the clipping path.
    const tile_corner_quadrilateral_points = Grid.getCellQuad(grid_column_index, grid_row_index, grid_configuration_settings);
    
    // WHAT: Asking the math module for the minimum bounding box that fits this sheared tile.
    // WHY: We need to know how big to make our offscreen canvas. We can't make an angled canvas, so we must make a rectangle big enough to hold the angled shape.
    const tile_bounding_box_dimensions = Grid.getCellBounds(grid_column_index, grid_row_index, grid_configuration_settings);

    // WHAT: Adding a 1-pixel buffer around the bounds.
    // WHY: When rendering anti-aliased diagonal lines on HTML canvas, sometimes the pixels right on the edge get clipped prematurely. Padding the canvas size slightly ensures a clean, sharp extraction without cut-off edges.
    const anti_aliasing_padding_pixels = 1;
    const required_canvas_width = Math.ceil(tile_bounding_box_dimensions.bounding_box_width) + (anti_aliasing_padding_pixels * 2);
    const required_canvas_height = Math.ceil(tile_bounding_box_dimensions.bounding_box_height) + (anti_aliasing_padding_pixels * 2);
    
    // WHAT: Calculating the exact X/Y offset to shift the drawing.
    // WHY: The tile might be located at pixel 500,500 on the source image, but our offscreen canvas starts at 0,0. We need this offset to shift the entire drawing operation backward so the target tile lands exactly in the center of our tiny offscreen canvas.
    const drawing_offset_x_pixels = Math.floor(tile_bounding_box_dimensions.bounding_box_x_position) - anti_aliasing_padding_pixels;
    const drawing_offset_y_pixels = Math.floor(tile_bounding_box_dimensions.bounding_box_y_position) - anti_aliasing_padding_pixels;

    const canvas_resources = retrieve_and_prepare_offscreen_canvas(required_canvas_width, required_canvas_height);
    const current_rendering_context = canvas_resources.rendering_context;

    // WHAT: Shifting all four corners of our stencil by the drawing offset.
    // WHY: Like the image itself, the stencil coordinates need to be translated from absolute world space into local canvas space (where top-left is 0,0).
    const local_canvas_quadrilateral_points = tile_corner_quadrilateral_points.map(absolute_pixel_coordinate => ({
      x_coordinate: absolute_pixel_coordinate.x_coordinate - drawing_offset_x_pixels,
      y_coordinate: absolute_pixel_coordinate.y_coordinate - drawing_offset_y_pixels,
    }));

    // WHAT: Defining the actual clipping path.
    // WHY: We tell the context to begin a path, move to the first corner, draw lines connecting the other three, close the shape, and then call 'clip()'. From this point forward, anything we draw will ONLY appear inside this shape.
    current_rendering_context.save();
    current_rendering_context.beginPath();
    current_rendering_context.moveTo(local_canvas_quadrilateral_points[0].x_coordinate, local_canvas_quadrilateral_points[0].y_coordinate);
    for (let current_vertex_index = 1; current_vertex_index < local_canvas_quadrilateral_points.length; current_vertex_index++) {
      current_rendering_context.lineTo(local_canvas_quadrilateral_points[current_vertex_index].x_coordinate, local_canvas_quadrilateral_points[current_vertex_index].y_coordinate);
    }
    current_rendering_context.closePath();
    current_rendering_context.clip();

    // WHAT: Drawing the massive source image onto our tiny offscreen canvas.
    // WHY: We use negative offsets to push the image up and to the left. The clipping path acts like a cookie cutter, only allowing the exact oblique tile pixels to transfer onto the canvas.
    current_rendering_context.drawImage(source_spritesheet_image, -drawing_offset_x_pixels, -drawing_offset_y_pixels);
    
    // WHAT: Restoring the canvas context.
    // WHY: This removes the clipping mask. It's a critical cleanup step so the next extraction doesn't accidentally inherit this tile's stencil.
    current_rendering_context.restore();

    // WHAT: Calculating the exact center point (the "anchor") of the tile.
    // WHY: Game engines need to know where the base of a tile is so they can layer them properly. We compute the center of the grid cell and offset it into local canvas coordinates.
    const absolute_cell_center_coordinate = Grid.getCellCenter(grid_column_index, grid_row_index, grid_configuration_settings);
    const local_tile_anchor_point = {
      x_coordinate: Math.round(absolute_cell_center_coordinate.x_coordinate - drawing_offset_x_pixels),
      y_coordinate: Math.round(absolute_cell_center_coordinate.y_coordinate - drawing_offset_y_pixels),
    };

    // WHAT: Generating the final Base64 encoded string of the PNG image data.
    // WHY: We convert the canvas pixels directly into a text string that we can safely store in JSON or display in an `img` tag.
    const extracted_base64_image_data_url = canvas_resources.canvas_element.toDataURL('image/png');

    return {
      tile_identifier_string: Grid.tileId(grid_column_index, grid_row_index),
      grid_column_index: grid_column_index,
      grid_row_index: grid_row_index,
      extracted_png_data_url: extracted_base64_image_data_url,
      tile_anchor_point_x_y: local_tile_anchor_point,
      tile_pixel_width: required_canvas_width,
      tile_pixel_height: required_canvas_height,
    };
  }

  // WHAT: Extracting an array of selected tiles all at once.
  // WHY: Users often highlight dozens of tiles to extract simultaneously. This loops through their selection and runs the single tile extraction logic on every one.
  function execute_batch_extraction_of_multiple_tiles(source_spritesheet_image, array_of_selected_cell_coordinates, grid_configuration_settings) {
    return array_of_selected_cell_coordinates.map(current_cell_coordinate => 
      perform_single_tile_extraction(source_spritesheet_image, current_cell_coordinate.grid_column_index, current_cell_coordinate.grid_row_index, grid_configuration_settings)
    );
  }

  // WHAT: Converting a Base64 text string back into raw binary blob data.
  // WHY: The zip library requires binary file data, not text strings. This function decodes the Base64 math, packs the bytes into an array, and wraps them in a Blob object so it can be saved as a real file.
  function convert_base64_data_url_into_binary_blob(base64_data_url_string) {
    const split_data_url_array = base64_data_url_string.split(',');
    const metadata_header_string = split_data_url_array[0];
    const encoded_base64_content = split_data_url_array[1];
    
    const extracted_mime_type_string = metadata_header_string.match(/:(.*?);/)[1];
    const decoded_binary_string = atob(encoded_base64_content);
    
    const unsigned_8bit_integer_array = new Uint8Array(decoded_binary_string.length);
    for (let current_byte_index = 0; current_byte_index < decoded_binary_string.length; current_byte_index++) {
      unsigned_8bit_integer_array[current_byte_index] = decoded_binary_string.charCodeAt(current_byte_index);
    }
    
    return new Blob([unsigned_8bit_integer_array], { type: extracted_mime_type_string });
  }

  return {
    extractTile: perform_single_tile_extraction,
    extractMultiple: execute_batch_extraction_of_multiple_tiles,
    dataUrlToBlob: convert_base64_data_url_into_binary_blob,
  };
})();
