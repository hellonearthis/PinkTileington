/* ============================================================
   PinkTileington — p5.js Canvas Sketch (Instance Mode)
   Image rendering, affine grid overlay, tile selection,
   pan/zoom, hover highlighting
   ============================================================ */

const CanvasSketch = (() => {
  'use strict';

  let local_p5_instance = null;
  let html_dom_container_element = null;

  let loaded_source_spritesheet_image = null;
  let source_image_pixel_width = 0;
  let source_image_pixel_height = 0;
  let source_image_filename_string = '';

  let view_pan_offset_x_pixels = 0;
  let view_pan_offset_y_pixels = 0;
  let current_view_zoom_level = 1;
  let minimum_allowed_zoom_level = 0.1;
  let maximum_allowed_zoom_level = 10;

  let is_user_currently_panning_boolean = false;
  let pan_interaction_start_x_coordinate = 0;
  let pan_interaction_start_y_coordinate = 0;

  let shared_grid_configuration_settings = null;

  let grid_overlay_opacity_float = 0.5;
  let grid_overlay_color_hex_string = '#e84393';
  let should_render_grid_overlay_boolean = true;

  let currently_hovered_grid_cell_object = null;
  const set_of_selected_tile_identifiers = new Set();

  let callback_function_on_hover = null;
  let callback_function_on_select = null;
  let callback_function_on_image_load = null;

  // WHAT: The main p5.js sketch definition wrapper.
  // WHY: We use p5.js in "Instance Mode" so it doesn't pollute the global window namespace and can be safely mounted into a specific HTML div container.
  function define_p5_sketch_instance(p5_context) {

    // WHAT: Initializing the canvas element.
    // WHY: This runs exactly once when the p5 instance boots up. We read the width and height of our HTML container so the canvas fits perfectly inside it.
    p5_context.setup = function () {
      const container_client_width = html_dom_container_element.clientWidth;
      const container_client_height = html_dom_container_element.clientHeight;
      const created_canvas_element = p5_context.createCanvas(container_client_width, container_client_height);
      created_canvas_element.parent(html_dom_container_element);
      p5_context.pixelDensity(1);
      p5_context.textFont('Inter');
    };

    // WHAT: The main render loop, drawing at ~60 frames per second.
    // WHY: p5 continuously calls this. We clear the screen, apply our zoom and pan transformations, draw the image, draw the grid, and finally draw the heads-up display.
    p5_context.draw = function () {
      p5_context.background(10, 10, 16);

      p5_context.push();
      p5_context.translate(view_pan_offset_x_pixels, view_pan_offset_y_pixels);
      p5_context.scale(current_view_zoom_level);

      if (loaded_source_spritesheet_image) {
        p5_context.image(loaded_source_spritesheet_image, 0, 0);
      }

      if (should_render_grid_overlay_boolean && shared_grid_configuration_settings && loaded_source_spritesheet_image) {
        execute_grid_overlay_rendering_routine(p5_context);
      }

      p5_context.pop();
      execute_heads_up_display_rendering_routine(p5_context);
    };

    // WHAT: Handling user mouse clicks.
    // WHY: Clicks dictate either panning the camera or selecting a tile. We check keyboard modifiers (Alt, Shift, Ctrl) to trigger the correct behavior.
    p5_context.mousePressed = function (mouse_event) {
      if (!is_mouse_inside_canvas_bounds(p5_context.mouseX, p5_context.mouseY)) return;

      // WHAT: Starting a pan operation.
      // WHY: If the user middle-clicks or holds Alt, they want to move the camera. We record the start position so we can calculate the distance dragged in the mouseDragged function.
      if (mouse_event.button === 1 || (mouse_event.button === 0 && mouse_event.altKey)) {
        is_user_currently_panning_boolean = true;
        pan_interaction_start_x_coordinate = p5_context.mouseX - view_pan_offset_x_pixels;
        pan_interaction_start_y_coordinate = p5_context.mouseY - view_pan_offset_y_pixels;
        return;
      }

      // WHAT: Selecting tiles.
      // WHY: A standard left click interacts with the grid.
      if (mouse_event.button === 0 && shared_grid_configuration_settings) {
        const absolute_world_coordinate = convert_screen_pixels_to_world_coordinates(p5_context.mouseX, p5_context.mouseY);
        const resolved_clicked_cell = Grid.hitTest(absolute_world_coordinate.x_coordinate, absolute_world_coordinate.y_coordinate, shared_grid_configuration_settings);
        
        if (resolved_clicked_cell) {
          const unique_tile_identifier = `${resolved_clicked_cell.grid_column_index},${resolved_clicked_cell.grid_row_index}`;
          
          if (mouse_event.ctrlKey || mouse_event.metaKey) {
            // Toggle selection.
            if (set_of_selected_tile_identifiers.has(unique_tile_identifier)) set_of_selected_tile_identifiers.delete(unique_tile_identifier);
            else set_of_selected_tile_identifiers.add(unique_tile_identifier);
          } else if (mouse_event.shiftKey && set_of_selected_tile_identifiers.size > 0) {
            // Shift-click range selection.
            const last_selected_tile_identifier = Array.from(set_of_selected_tile_identifiers).pop();
            const string_split_array = last_selected_tile_identifier.split(',');
            const last_column_index = Number(string_split_array[0]);
            const last_row_index = Number(string_split_array[1]);
            
            const minimum_column = Math.min(last_column_index, resolved_clicked_cell.grid_column_index);
            const maximum_column = Math.max(last_column_index, resolved_clicked_cell.grid_column_index);
            const minimum_row = Math.min(last_row_index, resolved_clicked_cell.grid_row_index);
            const maximum_row = Math.max(last_row_index, resolved_clicked_cell.grid_row_index);
            
            for (let current_column = minimum_column; current_column <= maximum_column; current_column++) {
              for (let current_row = minimum_row; current_row <= maximum_row; current_row++) {
                set_of_selected_tile_identifiers.add(`${current_column},${current_row}`);
              }
            }
          } else {
            // Single select.
            set_of_selected_tile_identifiers.clear();
            set_of_selected_tile_identifiers.add(unique_tile_identifier);
          }
          if (callback_function_on_select) callback_function_on_select(set_of_selected_tile_identifiers);
        }
      }
    };

    // WHAT: Updating the camera pan position while the mouse is dragged.
    // WHY: This creates the illusion of moving the canvas around. We subtract the start coordinate from the current mouse coordinate.
    p5_context.mouseDragged = function () {
      if (is_user_currently_panning_boolean) {
        view_pan_offset_x_pixels = p5_context.mouseX - pan_interaction_start_x_coordinate;
        view_pan_offset_y_pixels = p5_context.mouseY - pan_interaction_start_y_coordinate;
      }
    };

    // WHAT: Stopping the pan operation.
    // WHY: Letting go of the mouse button should stop the camera from moving.
    p5_context.mouseReleased = function () {
      is_user_currently_panning_boolean = false;
    };

    // WHAT: Tracking which cell the user is hovering over.
    // WHY: Highlighting the cell under the mouse cursor provides critical visual feedback to the user so they know what they are about to click.
    p5_context.mouseMoved = function () {
      if (!shared_grid_configuration_settings || !is_mouse_inside_canvas_bounds(p5_context.mouseX, p5_context.mouseY)) {
        currently_hovered_grid_cell_object = null;
        if (callback_function_on_hover) callback_function_on_hover(null);
        return;
      }
      const absolute_world_coordinate = convert_screen_pixels_to_world_coordinates(p5_context.mouseX, p5_context.mouseY);
      currently_hovered_grid_cell_object = Grid.hitTest(absolute_world_coordinate.x_coordinate, absolute_world_coordinate.y_coordinate, shared_grid_configuration_settings);
      if (callback_function_on_hover) callback_function_on_hover(currently_hovered_grid_cell_object);
    };

    // WHAT: Zooming in and out with the mouse wheel.
    // WHY: Users need to see fine details. We calculate a zoom factor and apply it, shifting the pan offset so that the zoom occurs centered exactly where their cursor is pointing.
    p5_context.mouseWheel = function (wheel_event) {
      if (!is_mouse_inside_canvas_bounds(p5_context.mouseX, p5_context.mouseY)) return;

      const zoom_multiplier_factor = wheel_event.delta > 0 ? 0.9 : 1.1;
      const calculated_new_zoom_level = p5_context.constrain(current_view_zoom_level * zoom_multiplier_factor, minimum_allowed_zoom_level, maximum_allowed_zoom_level);

      const unzoomed_world_x = (p5_context.mouseX - view_pan_offset_x_pixels) / current_view_zoom_level;
      const unzoomed_world_y = (p5_context.mouseY - view_pan_offset_y_pixels) / current_view_zoom_level;

      current_view_zoom_level = calculated_new_zoom_level;
      view_pan_offset_x_pixels = p5_context.mouseX - unzoomed_world_x * current_view_zoom_level;
      view_pan_offset_y_pixels = p5_context.mouseY - unzoomed_world_y * current_view_zoom_level;

      return false; // Prevent the entire browser window from scrolling.
    };

    // WHAT: Handling browser window resizing.
    // WHY: If the user makes their browser window larger, the canvas element should expand to fill the newly available space.
    p5_context.windowResized = function () {
      const container_client_width = html_dom_container_element.clientWidth;
      const container_client_height = html_dom_container_element.clientHeight;
      p5_context.resizeCanvas(container_client_width, container_client_height);
    };
  }

  // WHAT: Drawing the grid lines and highlighting cells.
  // WHY: This is the visual core of the application. We iterate over every configured row and column, get its corner coordinates, and draw shapes.
  function execute_grid_overlay_rendering_routine(p5_context) {
    const active_configuration = shared_grid_configuration_settings;

    const parsed_p5_color_object = p5_context.color(grid_overlay_color_hex_string);
    const color_channel_red = p5_context.red(parsed_p5_color_object);
    const color_channel_green = p5_context.green(parsed_p5_color_object);
    const color_channel_blue = p5_context.blue(parsed_p5_color_object);

    p5_context.strokeWeight(1 / current_view_zoom_level);
    p5_context.noFill();

    for (let current_column = 0; current_column < active_configuration.total_grid_columns; current_column++) {
      for (let current_row = 0; current_row < active_configuration.total_grid_rows; current_row++) {
        const cell_corner_quadrilateral = Grid.getCellQuad(current_column, current_row, active_configuration);
        const unique_tile_identifier = `${current_column},${current_row}`;
        const is_cell_currently_selected = set_of_selected_tile_identifiers.has(unique_tile_identifier);
        
        let is_cell_currently_hovered = false;
        if (currently_hovered_grid_cell_object && currently_hovered_grid_cell_object.grid_column_index === current_column && currently_hovered_grid_cell_object.grid_row_index === current_row) {
          is_cell_currently_hovered = true;
        }

        // WHAT: Styling the cell differently based on interaction state.
        // WHY: Selected cells get a solid fill, hovered cells get a lighter fill, and normal cells are just wireframes.
        if (is_cell_currently_selected) {
          p5_context.fill(color_channel_red, color_channel_green, color_channel_blue, 60);
          p5_context.stroke(color_channel_red, color_channel_green, color_channel_blue, 220);
          p5_context.strokeWeight(2 / current_view_zoom_level);
        } else if (is_cell_currently_hovered) {
          p5_context.fill(color_channel_red, color_channel_green, color_channel_blue, 30);
          p5_context.stroke(color_channel_red, color_channel_green, color_channel_blue, 180);
          p5_context.strokeWeight(1.5 / current_view_zoom_level);
        } else {
          p5_context.noFill();
          p5_context.stroke(color_channel_red, color_channel_green, color_channel_blue, grid_overlay_opacity_float * 255);
          p5_context.strokeWeight(1 / current_view_zoom_level);
        }

        p5_context.beginShape();
        for (const vertex_point of cell_corner_quadrilateral) {
          p5_context.vertex(vertex_point.x_coordinate, vertex_point.y_coordinate);
        }
        p5_context.endShape(p5_context.CLOSE);
      }
    }

    // WHAT: Drawing collision indicator symbols over edited tiles.
    // WHY: A visual checkmark or 'X' immediately shows the user which tiles they have already configured collision data for.
    p5_context.textSize(10 / current_view_zoom_level);
    p5_context.textAlign(p5_context.CENTER, p5_context.CENTER);
    p5_context.noStroke();
    for (let current_column = 0; current_column < active_configuration.total_grid_columns; current_column++) {
      for (let current_row = 0; current_row < active_configuration.total_grid_rows; current_row++) {
        const strict_tile_identifier = Grid.tileId(current_column, current_row);
        if (Collision.hasData(strict_tile_identifier)) {
          const absolute_cell_center = Grid.getCellCenter(current_column, current_row, active_configuration);
          const retrieved_collision_data = Collision.get(strict_tile_identifier);
          const visual_indicator_character = retrieved_collision_data.isWalkable ? '✓' : '✕';
          const visual_indicator_color = retrieved_collision_data.isWalkable ? p5_context.color(0, 206, 201, 180) : p5_context.color(255, 107, 107, 180);
          
          p5_context.fill(visual_indicator_color);
          p5_context.text(visual_indicator_character, absolute_cell_center.x_coordinate, absolute_cell_center.y_coordinate);
        }
      }
    }
  }

  // WHAT: Drawing persistent HUD elements that ignore zoom and panning.
  // WHY: The zoom percentage text needs to stick to the top left corner of the screen regardless of where the camera is looking.
  function execute_heads_up_display_rendering_routine(p5_context) {
    p5_context.push();
    p5_context.noStroke();
    p5_context.fill(0, 0, 0, 120);
    p5_context.rect(8, 8, 70, 24, 6);
    p5_context.fill(200);
    p5_context.textSize(11);
    p5_context.textAlign(p5_context.LEFT, p5_context.CENTER);
    p5_context.text(`${(current_view_zoom_level * 100).toFixed(0)}%`, 16, 20);
    p5_context.pop();
  }

  // WHAT: Converting a raw screen pixel to an absolute world space pixel.
  // WHY: If you are zoomed in by 200% and pan the camera, clicking exactly 100 pixels from the left of the monitor does NOT mean you clicked pixel 100 on the image. This math reverses the camera transformations.
  function convert_screen_pixels_to_world_coordinates(screen_x_pixel, screen_y_pixel) {
    return {
      x_coordinate: (screen_x_pixel - view_pan_offset_x_pixels) / current_view_zoom_level,
      y_coordinate: (screen_y_pixel - view_pan_offset_y_pixels) / current_view_zoom_level,
    };
  }

  // WHAT: Checking if the mouse is physically inside the canvas element.
  // WHY: If the mouse leaves the canvas to click a UI button, we shouldn't trigger canvas panning or selection.
  function is_mouse_inside_canvas_bounds(mouse_x_coordinate, mouse_y_coordinate) {
    return mouse_x_coordinate >= 0 && mouse_x_coordinate < local_p5_instance.width && mouse_y_coordinate >= 0 && mouse_y_coordinate < local_p5_instance.height;
  }

  // WHAT: The public boot function.
  // WHY: The App orchestrator calls this once the HTML is ready, passing in the callbacks it wants to listen to.
  function initialize_canvas_environment(html_container_identifier_string, initial_grid_configuration, callback_functions_object = {}) {
    html_dom_container_element = document.getElementById(html_container_identifier_string);
    shared_grid_configuration_settings = initial_grid_configuration;
    
    callback_function_on_hover = callback_functions_object.onHover || null;
    callback_function_on_select = callback_functions_object.onSelect || null;
    callback_function_on_image_load = callback_functions_object.onImageLoad || null;

    local_p5_instance = new p5(define_p5_sketch_instance);
  }

  // WHAT: Loading a file from the user's hard drive into the canvas.
  // WHY: We read the File object as a Data URL, ask p5 to load it as an Image object, and then automatically calculate a grid size that perfectly fits it.
  function load_local_image_file(target_file_object) {
    return new Promise((promise_resolve_function) => {
      const file_reader_instance = new FileReader();
      file_reader_instance.onload = (file_read_event) => {
        local_p5_instance.loadImage(file_read_event.target.result, (loaded_p5_image_object) => {
          loaded_source_spritesheet_image = loaded_p5_image_object;
          source_image_pixel_width = loaded_p5_image_object.width;
          source_image_pixel_height = loaded_p5_image_object.height;
          source_image_filename_string = target_file_object.name;

          const container_client_width = html_dom_container_element.clientWidth;
          const container_client_height = html_dom_container_element.clientHeight;
          
          current_view_zoom_level = Math.min(container_client_width / loaded_p5_image_object.width, container_client_height / loaded_p5_image_object.height) * 0.85;
          view_pan_offset_x_pixels = (container_client_width - loaded_p5_image_object.width * current_view_zoom_level) / 2;
          view_pan_offset_y_pixels = (container_client_height - loaded_p5_image_object.height * current_view_zoom_level) / 2;

          // Ask the math module to guess how many rows and columns we need.
          const auto_calculated_grid_fit_dimensions = Grid.autoFit(loaded_p5_image_object.width, loaded_p5_image_object.height, shared_grid_configuration_settings);
          shared_grid_configuration_settings.total_grid_columns = auto_calculated_grid_fit_dimensions.total_calculated_columns;
          shared_grid_configuration_settings.total_grid_rows = auto_calculated_grid_fit_dimensions.total_calculated_rows;

          if (callback_function_on_image_load) callback_function_on_image_load(source_image_filename_string, loaded_p5_image_object.width, loaded_p5_image_object.height);
          promise_resolve_function({ width: loaded_p5_image_object.width, height: loaded_p5_image_object.height, filename: target_file_object.name });
        });
      };
      file_reader_instance.readAsDataURL(target_file_object);
    });
  }

  function retrieve_source_image_element() {
    if (!loaded_source_spritesheet_image) return null;
    return loaded_source_spritesheet_image.canvas || loaded_source_spritesheet_image.elt || null;
  }

  function retrieve_source_filename_string() {
    return source_image_filename_string;
  }

  function retrieve_source_image_dimensions() {
    return { width: source_image_pixel_width, height: source_image_pixel_height };
  }

  function check_if_image_is_loaded() {
    return loaded_source_spritesheet_image !== null;
  }

  function update_shared_grid_configuration(new_grid_configuration_object) {
    Object.assign(shared_grid_configuration_settings, new_grid_configuration_object);
  }

  function update_grid_overlay_opacity(new_opacity_float_value) {
    grid_overlay_opacity_float = new_opacity_float_value;
  }

  function update_grid_overlay_color(new_hex_color_string) {
    grid_overlay_color_hex_string = new_hex_color_string;
  }

  function update_grid_overlay_visibility(should_be_visible_boolean) {
    should_render_grid_overlay_boolean = should_be_visible_boolean;
  }

  function retrieve_array_of_selected_grid_cells() {
    return Array.from(set_of_selected_tile_identifiers).map(comma_separated_identifier_string => {
      const string_split_array = comma_separated_identifier_string.split(',');
      return { 
        grid_column_index: Number(string_split_array[0]), 
        grid_row_index: Number(string_split_array[1]) 
      };
    });
  }

  function clear_all_current_cell_selections() {
    set_of_selected_tile_identifiers.clear();
    if (callback_function_on_select) callback_function_on_select(set_of_selected_tile_identifiers);
  }

  function select_all_available_grid_cells() {
    if (!shared_grid_configuration_settings) return;
    set_of_selected_tile_identifiers.clear();
    for (let current_column = 0; current_column < shared_grid_configuration_settings.total_grid_columns; current_column++) {
      for (let current_row = 0; current_row < shared_grid_configuration_settings.total_grid_rows; current_row++) {
        set_of_selected_tile_identifiers.add(`${current_column},${current_row}`);
      }
    }
    if (callback_function_on_select) callback_function_on_select(set_of_selected_tile_identifiers);
  }

  function automatically_fit_camera_to_view_entire_image() {
    if (!loaded_source_spritesheet_image) return;
    const container_client_width = html_dom_container_element.clientWidth;
    const container_client_height = html_dom_container_element.clientHeight;
    current_view_zoom_level = Math.min(container_client_width / source_image_pixel_width, container_client_height / source_image_pixel_height) * 0.85;
    view_pan_offset_x_pixels = (container_client_width - source_image_pixel_width * current_view_zoom_level) / 2;
    view_pan_offset_y_pixels = (container_client_height - source_image_pixel_height * current_view_zoom_level) / 2;
  }

  return {
    init: initialize_canvas_environment,
    loadImage: load_local_image_file,
    getSourceImage: retrieve_source_image_element,
    getSourceFilename: retrieve_source_filename_string,
    getSourceDimensions: retrieve_source_image_dimensions,
    hasImage: check_if_image_is_loaded,
    setGridConfig: update_shared_grid_configuration,
    setGridOpacity: update_grid_overlay_opacity,
    setGridColor: update_grid_overlay_color,
    setShowGrid: update_grid_overlay_visibility,
    getSelectedCells: retrieve_array_of_selected_grid_cells,
    clearSelection: clear_all_current_cell_selections,
    selectAll: select_all_available_grid_cells,
    fitView: automatically_fit_camera_to_view_entire_image,
  };
})();
