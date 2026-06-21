/* ============================================================
   PinkTileington — App Orchestrator
   Wires UI controls to canvas, extraction, and export modules
   ============================================================ */

const App = (() => {
  'use strict';

  // WHAT: Initializing the shared grid configuration state from our math module defaults.
  // WHY: We need a central source of truth for the grid settings. The UI sliders will mutate this object, and the Canvas will read from it to draw the overlay.
  const shared_global_grid_configuration = Grid.defaults();

  // WHAT: An array holding all tiles the user has extracted so far (deduplicated by tile ID).
  // WHY: As users extract tiles from different parts of the image, we accumulate them here.
  //       This flat array is used by the gallery, collision editor, and standalone JSON export.
  let array_of_all_extracted_tiles = [];

  // WHAT: An array of extraction set objects, each representing one batch of tiles the user extracted.
  // WHY: Each extraction set preserves the spatial layout of the tiles relative to each other at
  //       the time they were extracted. When building the combined spritesheet for ZIP export, we
  //       use these sets to lay out tiles so that grouped objects (like multi-tile buildings) keep
  //       their shape. New extractions are appended as new sets, never overwriting existing ones.
  let array_of_all_extraction_sets = [];

  // WHAT: The unique ID of the tile currently selected in the sidebar gallery.
  // WHY: When a user clicks a tile in the gallery, we need to know which one they clicked so we can show its specific collision metadata in the collision panel.
  let currently_active_tile_identifier_string = null;

  /* ============================================================
     INITIALIZATION
     ============================================================ */

  // WHAT: The main boot sequence for the application.
  // WHY: This is called once the HTML finishes loading to wire up all the buttons, sliders, and canvas systems.
  function execute_application_boot_sequence() {
    initialize_canvas_sketch_subsystem();
    initialize_sidebar_tab_switching_logic();
    initialize_grid_control_sliders_and_toggles();
    initialize_file_drag_and_drop_zone();
    initialize_json_atlas_import_workflow();
    initialize_tile_extraction_buttons();
    initialize_collision_editing_controls();
    initialize_export_buttons();
    initialize_keyboard_event_listeners();
    initialize_global_reset_button();
    update_status_bar_message_text('Ready — drop an image to begin');
  }

  /* ---- Canvas ---- */

  // WHAT: Booting up the p5.js canvas and passing in our callback functions.
  // WHY: The canvas needs to talk back to the UI when certain things happen (like hovering or selecting cells). We pass these functions so the canvas can trigger UI updates without knowing how the UI works.
  function initialize_canvas_sketch_subsystem() {
    CanvasSketch.init('canvas-container', shared_global_grid_configuration, {
      onHover: handle_canvas_cell_hover_event,
      onSelect: handle_canvas_cell_selection_event,
      onImageLoad: handle_canvas_image_load_event,
    });
  }

  /* ---- Callbacks ---- */

  // WHAT: Updating the status bar with the current cell coordinate the mouse is hovering over.
  // WHY: Gives the user immediate feedback on exactly where they are pointing in grid space.
  function handle_canvas_cell_hover_event(hovered_grid_cell_object) {
    const coordinates_text_element = document.getElementById('status-coords');
    if (hovered_grid_cell_object) {
      coordinates_text_element.textContent = `Col: ${hovered_grid_cell_object.grid_column_index}  Row: ${hovered_grid_cell_object.grid_row_index}`;
    } else {
      coordinates_text_element.textContent = '—';
    }
  }

  // WHAT: Updating the UI when the user selects or deselects tiles.
  // WHY: We need to show how many tiles are selected, and enable the "Extract" button only if at least one tile is actually selected.
  function handle_canvas_cell_selection_event(set_of_selected_tile_identifiers) {
    const selection_count_text_element = document.getElementById('status-selected');
    selection_count_text_element.textContent = `${set_of_selected_tile_identifiers.size} selected`;

    const extract_tiles_button_element = document.getElementById('btn-extract');
    if (extract_tiles_button_element) {
      extract_tiles_button_element.disabled = set_of_selected_tile_identifiers.size === 0;
    }
  }

  // WHAT: Handling the event when a new image finishes loading into the canvas.
  // WHY: We need to update the status bar dimensions, hide the "drop an image here" empty state overlay, and sync the grid sliders to the newly auto-calculated grid size.
  function handle_canvas_image_load_event(source_image_filename_string, source_image_pixel_width, source_image_pixel_height) {
    const dimensions_text_element = document.getElementById('status-dimensions');
    dimensions_text_element.textContent = `${source_image_pixel_width}×${source_image_pixel_height}`;

    const status_dot_element = document.getElementById('status-dot');
    status_dot_element.className = 'status-dot';

    const file_drop_zone_element = document.querySelector('.drop-zone');
    if (file_drop_zone_element) file_drop_zone_element.classList.remove('empty-state');

    document.getElementById('ctrl-cols').value = shared_global_grid_configuration.total_grid_columns;
    document.getElementById('ctrl-rows').value = shared_global_grid_configuration.total_grid_rows;
    document.getElementById('val-cols').textContent = shared_global_grid_configuration.total_grid_columns;
    document.getElementById('val-rows').textContent = shared_global_grid_configuration.total_grid_rows;

    trigger_floating_toast_notification(`Loaded "${source_image_filename_string}" (${source_image_pixel_width}×${source_image_pixel_height})`, 'success');
    update_status_bar_message_text(`Image loaded: ${source_image_filename_string}`);
  }

  /* ============================================================
     TAB SWITCHING
     ============================================================ */

  // WHAT: Wiring up the sidebar tabs to show and hide different panels.
  // WHY: The UI has multiple tools (Grid, Tiles, Collision, Export) but we only want to show one panel at a time to save space.
  function initialize_sidebar_tab_switching_logic() {
    const array_of_tab_button_elements = document.querySelectorAll('.sidebar-tab');
    array_of_tab_button_elements.forEach(current_tab_button_element => {
      current_tab_button_element.addEventListener('click', () => {
        array_of_tab_button_elements.forEach(other_tab_button_element => other_tab_button_element.classList.remove('active'));
        current_tab_button_element.classList.add('active');

        const array_of_tab_panel_elements = document.querySelectorAll('.tab-panel');
        array_of_tab_panel_elements.forEach(current_panel_element => current_panel_element.classList.remove('active'));
        
        const target_panel_identifier = current_tab_button_element.dataset.tab;
        const target_panel_element = document.getElementById(target_panel_identifier);
        if (target_panel_element) target_panel_element.classList.add('active');
      });
    });
  }

  /* ============================================================
     GRID CONTROLS
     ============================================================ */

  // WHAT: Wiring up all the sliders in the Grid tab.
  // WHY: Whenever a user moves a slider, we need to update the mathematical configuration object and immediately tell the Canvas to redraw the overlay with the new settings.
  function initialize_grid_control_sliders_and_toggles() {
    bind_html_slider_to_state_variable('ctrl-cellW', 'val-cellW', 8, 256, shared_global_grid_configuration.cell_width_pixels, (new_slider_value) => {
      shared_global_grid_configuration.cell_width_pixels = new_slider_value;
      recalculate_automatic_grid_fit_extents();
      CanvasSketch.setGridConfig(shared_global_grid_configuration);
    });

    bind_html_slider_to_state_variable('ctrl-cellH', 'val-cellH', 8, 256, shared_global_grid_configuration.cell_height_pixels, (new_slider_value) => {
      shared_global_grid_configuration.cell_height_pixels = new_slider_value;
      recalculate_automatic_grid_fit_extents();
      CanvasSketch.setGridConfig(shared_global_grid_configuration);
    });

    bind_html_slider_to_state_variable('ctrl-shearX', 'val-shearX', -78, 78, convert_radians_to_degrees(shared_global_grid_configuration.shear_angle_x_radians), (new_slider_value) => {
      shared_global_grid_configuration.shear_angle_x_radians = convert_degrees_to_radians(new_slider_value);
      CanvasSketch.setGridConfig(shared_global_grid_configuration);
    }, (formatted_value) => `${formatted_value}°`);

    bind_html_slider_to_state_variable('ctrl-shearY', 'val-shearY', -78, 78, convert_radians_to_degrees(shared_global_grid_configuration.shear_angle_y_radians), (new_slider_value) => {
      shared_global_grid_configuration.shear_angle_y_radians = convert_degrees_to_radians(new_slider_value);
      CanvasSketch.setGridConfig(shared_global_grid_configuration);
    }, (formatted_value) => `${formatted_value}°`);

    bind_html_slider_to_state_variable('ctrl-originX', 'val-originX', -500, 500, shared_global_grid_configuration.grid_origin_offset_x_pixels, (new_slider_value) => {
      shared_global_grid_configuration.grid_origin_offset_x_pixels = new_slider_value;
      CanvasSketch.setGridConfig(shared_global_grid_configuration);
    }, (formatted_value) => `${formatted_value}px`);

    bind_html_slider_to_state_variable('ctrl-originY', 'val-originY', -500, 500, shared_global_grid_configuration.grid_origin_offset_y_pixels, (new_slider_value) => {
      shared_global_grid_configuration.grid_origin_offset_y_pixels = new_slider_value;
      CanvasSketch.setGridConfig(shared_global_grid_configuration);
    }, (formatted_value) => `${formatted_value}px`);

    bind_html_slider_to_state_variable('ctrl-cols', 'val-cols', 1, 100, shared_global_grid_configuration.total_grid_columns, (new_slider_value) => {
      shared_global_grid_configuration.total_grid_columns = new_slider_value;
      CanvasSketch.setGridConfig(shared_global_grid_configuration);
    });

    bind_html_slider_to_state_variable('ctrl-rows', 'val-rows', 1, 100, shared_global_grid_configuration.total_grid_rows, (new_slider_value) => {
      shared_global_grid_configuration.total_grid_rows = new_slider_value;
      CanvasSketch.setGridConfig(shared_global_grid_configuration);
    });

    bind_html_slider_to_state_variable('ctrl-opacity', 'val-opacity', 0, 100, 50, (new_slider_value) => {
      CanvasSketch.setGridOpacity(new_slider_value / 100);
    }, (formatted_value) => `${formatted_value}%`);

    // Grid color picker
    const grid_color_input_element = document.getElementById('ctrl-gridColor');
    if (grid_color_input_element) {
      grid_color_input_element.value = '#e84393';
      grid_color_input_element.addEventListener('input', () => {
        CanvasSketch.setGridColor(grid_color_input_element.value);
      });
    }

    // Show grid toggle switch
    const toggle_grid_visibility_element = document.getElementById('ctrl-showGrid');
    if (toggle_grid_visibility_element) {
      toggle_grid_visibility_element.checked = true;
      toggle_grid_visibility_element.addEventListener('change', () => {
        CanvasSketch.setShowGrid(toggle_grid_visibility_element.checked);
      });
    }
  }

  /* ============================================================
     DROP ZONE / FILE INPUT
     ============================================================ */

  // WHAT: Wiring up the drag-and-drop zone over the canvas.
  // WHY: Users prefer to just drag an image from their desktop onto the app. We have to intercept the browser's default behavior (which would just open the image in a new tab) and route the file to our loader.
  function initialize_file_drag_and_drop_zone() {
    const main_canvas_container_element = document.getElementById('canvas-container');
    const visual_drop_zone_overlay_element = document.querySelector('.drop-zone');
    const hidden_file_input_element = document.getElementById('file-input');

    main_canvas_container_element.addEventListener('dragover', (drag_event) => {
      drag_event.preventDefault(); // Stop browser from opening file
      if (visual_drop_zone_overlay_element) visual_drop_zone_overlay_element.classList.add('active');
    });

    main_canvas_container_element.addEventListener('dragleave', () => {
      if (visual_drop_zone_overlay_element && !visual_drop_zone_overlay_element.classList.contains('empty-state')) {
        visual_drop_zone_overlay_element.classList.remove('active');
      }
    });

    main_canvas_container_element.addEventListener('drop', (drag_event) => {
      drag_event.preventDefault();
      if (visual_drop_zone_overlay_element) visual_drop_zone_overlay_element.classList.remove('active');
      
      const dropped_file_object = drag_event.dataTransfer.files[0];
      if (dropped_file_object && dropped_file_object.type.startsWith('image/')) {
        execute_image_loading_process(dropped_file_object);
      }
    });

    if (visual_drop_zone_overlay_element) {
      visual_drop_zone_overlay_element.addEventListener('click', () => {
        if (hidden_file_input_element) hidden_file_input_element.click();
      });
    }

    if (hidden_file_input_element) {
      hidden_file_input_element.addEventListener('change', () => {
        const selected_file_object = hidden_file_input_element.files[0];
        if (selected_file_object) execute_image_loading_process(selected_file_object);
      });
    }

    const open_image_header_button_element = document.getElementById('btn-load');
    if (open_image_header_button_element) {
      open_image_header_button_element.addEventListener('click', () => {
        if (hidden_file_input_element) hidden_file_input_element.click();
      });
    }
  }

  async function execute_image_loading_process(target_file_object) {
    update_status_bar_message_text(`Loading ${target_file_object.name}...`);
    await CanvasSketch.loadImage(target_file_object);
  }

  /* ============================================================
     IMPORT JSON
     ============================================================ */

  // WHAT: Wiring up the Import JSON button.
  // WHY: Users might want to load a previously exported JSON atlas to add more tiles to it. We need a hidden file input that accepts JSON files and parses them.
  function initialize_json_atlas_import_workflow() {
    const import_json_header_button_element = document.getElementById('btn-import-json');
    const hidden_json_file_input_element = document.getElementById('file-input-json');

    if (import_json_header_button_element && hidden_json_file_input_element) {
      import_json_header_button_element.addEventListener('click', () => {
        hidden_json_file_input_element.click();
      });

      hidden_json_file_input_element.addEventListener('change', () => {
        const selected_json_file_object = hidden_json_file_input_element.files[0];
        if (!selected_json_file_object) return;

        const file_reader_instance = new FileReader();
        file_reader_instance.onload = (file_read_event) => {
          try {
            const parsed_json_atlas_object = JSON.parse(file_read_event.target.result);
            restore_application_state_from_atlas_object(parsed_json_atlas_object);
            hidden_json_file_input_element.value = ''; 
          } catch (error) {
            trigger_floating_toast_notification('Failed to parse JSON atlas', 'error');
            console.error(error);
          }
        };
        file_reader_instance.readAsText(selected_json_file_object);
      });
    }
  }

  // WHAT: Restoring the entire app state from an imported JSON object.
  // WHY: The JSON contains grid settings, extracted tiles, and collision data. We must manually push all this data back into the App state, Grid Math module, Canvas Sketch, and UI sliders.
  function restore_application_state_from_atlas_object(imported_atlas_json_object) {
    if (!imported_atlas_json_object.meta || !imported_atlas_json_object.tiles) {
      trigger_floating_toast_notification('Invalid atlas format', 'error');
      return;
    }

    // 1. Restore grid config
    if (imported_atlas_json_object.meta.grid) {
      Object.assign(shared_global_grid_configuration, imported_atlas_json_object.meta.grid);
      CanvasSketch.setGridConfig(shared_global_grid_configuration);

      // Helper to update slider and label
      const update_slider_ui = (slider_element_id, slider_value, label_element_id, label_text) => {
        const slider_element = document.getElementById(slider_element_id);
        if (slider_element) slider_element.value = slider_value;
        const label_element = document.getElementById(label_element_id);
        if (label_element) label_element.textContent = label_text;
      };

      update_slider_ui('ctrl-cellW', shared_global_grid_configuration.cell_width_pixels, 'val-cellW', shared_global_grid_configuration.cell_width_pixels);
      update_slider_ui('ctrl-cellH', shared_global_grid_configuration.cell_height_pixels, 'val-cellH', shared_global_grid_configuration.cell_height_pixels);
      update_slider_ui('ctrl-shearX', convert_radians_to_degrees(shared_global_grid_configuration.shear_angle_x_radians), 'val-shearX', `${convert_radians_to_degrees(shared_global_grid_configuration.shear_angle_x_radians)}°`);
      update_slider_ui('ctrl-shearY', convert_radians_to_degrees(shared_global_grid_configuration.shear_angle_y_radians), 'val-shearY', `${convert_radians_to_degrees(shared_global_grid_configuration.shear_angle_y_radians)}°`);
      update_slider_ui('ctrl-originX', shared_global_grid_configuration.grid_origin_offset_x_pixels, 'val-originX', `${shared_global_grid_configuration.grid_origin_offset_x_pixels}px`);
      update_slider_ui('ctrl-originY', shared_global_grid_configuration.grid_origin_offset_y_pixels, 'val-originY', `${shared_global_grid_configuration.grid_origin_offset_y_pixels}px`);
      update_slider_ui('ctrl-cols', shared_global_grid_configuration.total_grid_columns, 'val-cols', shared_global_grid_configuration.total_grid_columns);
      update_slider_ui('ctrl-rows', shared_global_grid_configuration.total_grid_rows, 'val-rows', shared_global_grid_configuration.total_grid_rows);
    }

    // 2. Restore tiles and collision
    // We create a map of existing tiles to merge the imported ones cleanly.
    const map_of_existing_tiles = new Map(array_of_all_extracted_tiles.map(current_tile_object => [current_tile_object.tile_identifier_string, current_tile_object]));

    imported_atlas_json_object.tiles.forEach(current_imported_tile_data => {
      // Reconstruct the internal tile object structure expected by our Extractor and Gallery
      const reconstructed_tile_object = {
        tile_identifier_string: current_imported_tile_data.id,
        grid_column_index: current_imported_tile_data.grid_x,
        grid_row_index: current_imported_tile_data.grid_y,
        tile_pixel_width: current_imported_tile_data.width || shared_global_grid_configuration.cell_width_pixels,
        tile_pixel_height: current_imported_tile_data.height || shared_global_grid_configuration.cell_height_pixels,
        tile_anchor_point_x_y: current_imported_tile_data.anchor_offset || { x_coordinate: 0, y_coordinate: 0 },
        extracted_png_data_url: current_imported_tile_data.visual_data // Will be empty if loaded from ZIP export JSON
      };

      if (reconstructed_tile_object.extracted_png_data_url) {
         map_of_existing_tiles.set(current_imported_tile_data.id, reconstructed_tile_object);
      }

      if (current_imported_tile_data.collision) {
         Collision.set(current_imported_tile_data.id, {
            type: current_imported_tile_data.collision.type,
            isWalkable: current_imported_tile_data.collision.isWalkable,
            polygon: current_imported_tile_data.collision.polygon
         });
      }
    });

    array_of_all_extracted_tiles = Array.from(map_of_existing_tiles.values());
    rebuild_and_render_tile_gallery_user_interface();
    trigger_floating_toast_notification(`Loaded atlas with ${imported_atlas_json_object.tiles.length} tiles`, 'success');
  }

  /* ============================================================
     TILE ACTIONS
     ============================================================ */

  // WHAT: Wiring up the buttons in the Tiles tab.
  // WHY: Connects the Extract, Select All, and Clear buttons to the canvas and extraction logic.
  function initialize_tile_extraction_buttons() {
    const extract_tiles_button_element = document.getElementById('btn-extract');
    if (extract_tiles_button_element) {
      extract_tiles_button_element.addEventListener('click', execute_tile_extraction_workflow);
    }

    const select_all_button_element = document.getElementById('btn-select-all');
    if (select_all_button_element) {
      select_all_button_element.addEventListener('click', () => CanvasSketch.selectAll());
    }

    const clear_selection_button_element = document.getElementById('btn-clear-selection');
    if (clear_selection_button_element) {
      clear_selection_button_element.addEventListener('click', () => CanvasSketch.clearSelection());
    }

    const clear_all_tiles_button_element = document.getElementById('btn-clear-tiles');
    if (clear_all_tiles_button_element) {
      clear_all_tiles_button_element.addEventListener('click', () => {
        array_of_all_extracted_tiles = [];
        array_of_all_extraction_sets = [];
        rebuild_and_render_tile_gallery_user_interface();
        trigger_floating_toast_notification('Cleared all extracted tiles and extraction sets', 'warning');
      });
    }
  }

  // WHAT: Triggering the Extractor to crop out the selected tiles and saving them to the gallery.
  // WHY: This is the core function of the app. It checks if anything is selected, calls the Extractor
  //       to do the math and clipping, builds an extraction set that preserves the spatial layout of
  //       the tiles relative to each other, and merges the tiles into the flat gallery array.
  function execute_tile_extraction_workflow() {
    const raw_html_source_image_element = CanvasSketch.getSourceImage();
    if (!raw_html_source_image_element) {
      trigger_floating_toast_notification('No image loaded', 'error');
      return;
    }

    const array_of_selected_grid_cells = CanvasSketch.getSelectedCells();
    if (array_of_selected_grid_cells.length === 0) {
      trigger_floating_toast_notification('No tiles selected', 'warning');
      return;
    }

    const array_of_newly_extracted_tiles = Extractor.extractMultiple(raw_html_source_image_element, array_of_selected_grid_cells, shared_global_grid_configuration);

    // WHAT: Computing the axis-aligned bounding box of each newly extracted tile in source-image pixel space.
    // WHY: We need each tile's absolute pixel position on the source image so we can calculate its
    //       relative offset within the extraction set. The extractor uses a 1px anti-aliasing padding
    //       that shifts the drawing origin, so we replicate that same offset here for consistency.
    const anti_aliasing_padding_pixels = 1;
    const array_of_tile_absolute_bounds = array_of_newly_extracted_tiles.map(current_tile_object => {
      const cell_bounding_box = Grid.getCellBounds(
        current_tile_object.grid_column_index,
        current_tile_object.grid_row_index,
        shared_global_grid_configuration
      );
      return {
        tile_object_reference: current_tile_object,
        absolute_x_pixels: Math.floor(cell_bounding_box.bounding_box_x_position) - anti_aliasing_padding_pixels,
        absolute_y_pixels: Math.floor(cell_bounding_box.bounding_box_y_position) - anti_aliasing_padding_pixels,
      };
    });

    // WHAT: Finding the minimum X and Y across all tiles in this batch.
    // WHY: Subtracting this minimum from each tile's absolute position gives us a zero-based
    //       relative offset that preserves the exact spatial arrangement of the selected tiles.
    const set_minimum_x_pixels = Math.min(...array_of_tile_absolute_bounds.map(current_tile_absolute_bound_object => current_tile_absolute_bound_object.absolute_x_pixels));
    const set_minimum_y_pixels = Math.min(...array_of_tile_absolute_bounds.map(current_tile_absolute_bound_object => current_tile_absolute_bound_object.absolute_y_pixels));

    // WHAT: Computing the total bounding rectangle of this extraction set.
    // WHY: The exporter needs to know the width and height of the rectangle so it can reserve
    //       the right amount of vertical space on the spritesheet when stacking sets.
    const set_maximum_x_pixels = Math.max(...array_of_tile_absolute_bounds.map(current_tile_absolute_bound_object => current_tile_absolute_bound_object.absolute_x_pixels + current_tile_absolute_bound_object.tile_object_reference.tile_pixel_width));
    const set_maximum_y_pixels = Math.max(...array_of_tile_absolute_bounds.map(current_tile_absolute_bound_object => current_tile_absolute_bound_object.absolute_y_pixels + current_tile_absolute_bound_object.tile_object_reference.tile_pixel_height));

    // WHAT: Building the extraction set object with per-tile relative offsets.
    // WHY: This object captures the spatial snapshot at extraction time. Even if the user later
    //       changes the grid settings or loads a different image, this set's layout is frozen.
    const newly_created_extraction_set = {
      set_identifier_string: `extraction_set_${Date.now()}`,
      bounding_width_pixels: Math.ceil(set_maximum_x_pixels - set_minimum_x_pixels),
      bounding_height_pixels: Math.ceil(set_maximum_y_pixels - set_minimum_y_pixels),
      tiles: array_of_tile_absolute_bounds.map(current_tile_absolute_bound_object => ({
        tile_identifier_string: current_tile_absolute_bound_object.tile_object_reference.tile_identifier_string,
        extracted_png_data_url: current_tile_absolute_bound_object.tile_object_reference.extracted_png_data_url,
        tile_pixel_width: current_tile_absolute_bound_object.tile_object_reference.tile_pixel_width,
        tile_pixel_height: current_tile_absolute_bound_object.tile_object_reference.tile_pixel_height,
        relative_x_within_set_pixels: current_tile_absolute_bound_object.absolute_x_pixels - set_minimum_x_pixels,
        relative_y_within_set_pixels: current_tile_absolute_bound_object.absolute_y_pixels - set_minimum_y_pixels,
      })),
    };

    array_of_all_extraction_sets.push(newly_created_extraction_set);

    // WHAT: Merging new tiles into the flat gallery array, deduplicating by tile ID.
    // WHY: The gallery and collision editor work with a single flat list of unique tiles.
    //       If the same grid cell is extracted again, we update its image data in the gallery.
    const map_of_existing_tiles = new Map(array_of_all_extracted_tiles.map(current_tile_object => [current_tile_object.tile_identifier_string, current_tile_object]));
    for (const newly_extracted_tile_object of array_of_newly_extracted_tiles) {
      map_of_existing_tiles.set(newly_extracted_tile_object.tile_identifier_string, newly_extracted_tile_object);
    }
    array_of_all_extracted_tiles = Array.from(map_of_existing_tiles.values());

    rebuild_and_render_tile_gallery_user_interface();
    trigger_floating_toast_notification(`Extracted ${array_of_newly_extracted_tiles.length} tile(s) — Set #${array_of_all_extraction_sets.length}`, 'success');

    switch_visible_sidebar_tab('panel-tiles');
  }

  // WHAT: Drawing the thumbnail grid of all extracted tiles in the sidebar.
  // WHY: Allows the user to see what they have extracted so far, and click them to edit their collision data.
  function rebuild_and_render_tile_gallery_user_interface() {
    const tile_gallery_container_element = document.getElementById('tile-gallery');
    if (!tile_gallery_container_element) return;

    if (array_of_all_extracted_tiles.length === 0) {
      tile_gallery_container_element.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <div class="empty-state-text">No tiles extracted yet.<br>Select cells and click Extract.</div>
        </div>`;
      return;
    }

    tile_gallery_container_element.innerHTML = '';
    for (const current_tile_object of array_of_all_extracted_tiles) {
      const tile_thumbnail_div_element = document.createElement('div');
      tile_thumbnail_div_element.className = 'tile-thumb';
      tile_thumbnail_div_element.dataset.tileId = current_tile_object.tile_identifier_string;
      
      if (current_tile_object.tile_identifier_string === currently_active_tile_identifier_string) {
        tile_thumbnail_div_element.classList.add('selected');
      }

      const thumbnail_image_element = document.createElement('img');
      thumbnail_image_element.src = current_tile_object.extracted_png_data_url;
      thumbnail_image_element.alt = current_tile_object.tile_identifier_string;
      tile_thumbnail_div_element.appendChild(thumbnail_image_element);

      const thumbnail_label_div_element = document.createElement('div');
      thumbnail_label_div_element.className = 'tile-thumb-label';
      thumbnail_label_div_element.textContent = `${current_tile_object.grid_column_index},${current_tile_object.grid_row_index}`;
      tile_thumbnail_div_element.appendChild(thumbnail_label_div_element);

      // Draw small colored dot if collision data exists
      if (Collision.hasData(current_tile_object.tile_identifier_string)) {
        const collision_indicator_dot_element = document.createElement('div');
        collision_indicator_dot_element.style.cssText = 'position:absolute;top:3px;right:3px;width:8px;height:8px;border-radius:50%;';
        const retrieved_collision_data = Collision.get(current_tile_object.tile_identifier_string);
        collision_indicator_dot_element.style.background = retrieved_collision_data.isWalkable ? 'var(--success)' : 'var(--danger)';
        tile_thumbnail_div_element.appendChild(collision_indicator_dot_element);
      }

      tile_thumbnail_div_element.addEventListener('click', () => {
        currently_active_tile_identifier_string = current_tile_object.tile_identifier_string;
        rebuild_and_render_tile_gallery_user_interface();
        update_collision_panel_user_interface(current_tile_object.tile_identifier_string);
        switch_visible_sidebar_tab('panel-collision');
      });

      tile_gallery_container_element.appendChild(tile_thumbnail_div_element);
    }
  }

  /* ============================================================
     COLLISION CONTROLS
     ============================================================ */

  // WHAT: Wiring up the dropdowns and toggles in the Collision tab.
  // WHY: This connects the HTML form elements to the underlying Collision data manager.
  function initialize_collision_editing_controls() {
    const collision_type_dropdown_element = document.getElementById('ctrl-collision-type');
    if (collision_type_dropdown_element) {
      collision_type_dropdown_element.addEventListener('change', () => {
        if (!currently_active_tile_identifier_string) return;
        Collision.setType(currently_active_tile_identifier_string, collision_type_dropdown_element.value);
        synchronize_collision_form_values_with_state();
        rebuild_and_render_tile_gallery_user_interface();
      });
    }

    const is_walkable_toggle_element = document.getElementById('ctrl-walkable');
    if (is_walkable_toggle_element) {
      is_walkable_toggle_element.addEventListener('change', () => {
        if (!currently_active_tile_identifier_string) return;
        Collision.set(currently_active_tile_identifier_string, { isWalkable: is_walkable_toggle_element.checked });
        rebuild_and_render_tile_gallery_user_interface();
      });
    }
  }

  // WHAT: Loading a specific tile's data into the collision editing form.
  // WHY: When a user clicks a tile in the gallery, we need to show that tile's image in the collision tab and set the dropdowns to match its current collision settings.
  function update_collision_panel_user_interface(target_tile_identifier_string) {
    const retrieved_tile_object = array_of_all_extracted_tiles.find(current_tile_object => current_tile_object.tile_identifier_string === target_tile_identifier_string);
    if (!retrieved_tile_object) return;

    const preview_image_element = document.getElementById('collision-preview-img');
    if (preview_image_element) {
      preview_image_element.src = retrieved_tile_object.extracted_png_data_url;
      preview_image_element.alt = retrieved_tile_object.tile_identifier_string;
    }

    const title_label_element = document.getElementById('collision-tile-label');
    if (title_label_element) title_label_element.textContent = retrieved_tile_object.tile_identifier_string;

    synchronize_collision_form_values_with_state();
  }

  // WHAT: Reading state from the Collision module and applying it to the HTML dropdowns.
  function synchronize_collision_form_values_with_state() {
    if (!currently_active_tile_identifier_string) return;
    const retrieved_collision_data = Collision.get(currently_active_tile_identifier_string);

    const collision_type_dropdown_element = document.getElementById('ctrl-collision-type');
    if (collision_type_dropdown_element) collision_type_dropdown_element.value = retrieved_collision_data.type;

    const is_walkable_toggle_element = document.getElementById('ctrl-walkable');
    if (is_walkable_toggle_element) is_walkable_toggle_element.checked = retrieved_collision_data.isWalkable;
  }

  /* ============================================================
     EXPORT ACTIONS
     ============================================================ */

  // WHAT: Wiring up the Export buttons.
  // WHY: Connects the export UI to the Exporter module.
  function initialize_export_buttons() {
    const export_json_button_element = document.getElementById('btn-export-json');
    if (export_json_button_element) {
      export_json_button_element.addEventListener('click', () => {
        if (array_of_all_extracted_tiles.length === 0) {
          trigger_floating_toast_notification('No tiles to export', 'warning');
          return;
        }
        Exporter.downloadJSON(array_of_all_extracted_tiles, shared_global_grid_configuration, CanvasSketch.getSourceFilename());
        trigger_floating_toast_notification('JSON atlas downloaded', 'success');
      });
    }

    const export_zip_button_element = document.getElementById('btn-export-zip');
    if (export_zip_button_element) {
      export_zip_button_element.addEventListener('click', async () => {
        if (array_of_all_extracted_tiles.length === 0) {
          trigger_floating_toast_notification('No tiles to export', 'warning');
          return;
        }
        try {
          await Exporter.downloadZIP(array_of_all_extracted_tiles, shared_global_grid_configuration, CanvasSketch.getSourceFilename(), array_of_all_extraction_sets);
          trigger_floating_toast_notification('ZIP archive downloaded', 'success');
        } catch (thrown_error_object) {
          trigger_floating_toast_notification(thrown_error_object.message, 'error');
        }
      });
    }

    const export_gm_button_element = document.getElementById('btn-export-gm');
    if (export_gm_button_element) {
      export_gm_button_element.addEventListener('click', async () => {
        if (array_of_all_extracted_tiles.length === 0) {
          trigger_floating_toast_notification('No tiles to export', 'warning');
          return;
        }
        try {
          await Exporter.downloadGameMaker(array_of_all_extracted_tiles, shared_global_grid_configuration, CanvasSketch.getSourceFilename());
          trigger_floating_toast_notification('GameMaker project downloaded', 'success');
        } catch (thrown_error_object) {
          trigger_floating_toast_notification(thrown_error_object.message, 'error');
        }
      });
    }
  }

  /* ============================================================
     UTILITIES
     ============================================================ */

  // WHAT: A helper function to bind a range slider to a state variable and an HTML text label.
  // WHY: Reduces boilerplate code. We have a lot of sliders. This function wires them all up consistently.
  function bind_html_slider_to_state_variable(html_slider_id_string, html_label_id_string, minimum_allowed_value, maximum_allowed_value, initial_default_value, callback_function_on_change, optional_formatting_function) {
    const html_slider_element = document.getElementById(html_slider_id_string);
    const html_label_element = document.getElementById(html_label_id_string);
    if (!html_slider_element) return;

    html_slider_element.min = minimum_allowed_value;
    html_slider_element.max = maximum_allowed_value;
    html_slider_element.value = initial_default_value;
    if (html_label_element) html_label_element.textContent = optional_formatting_function ? optional_formatting_function(initial_default_value) : initial_default_value;

    html_slider_element.addEventListener('input', () => {
      const parsed_float_slider_value = parseFloat(html_slider_element.value);
      if (html_label_element) html_label_element.textContent = optional_formatting_function ? optional_formatting_function(parsed_float_slider_value) : parsed_float_slider_value;
      callback_function_on_change(parsed_float_slider_value);
    });
  }

  // WHAT: Programmatically switching the active sidebar tab.
  // WHY: When a user clicks "Extract", we automatically switch them to the Tiles tab so they can see what just happened.
  function switch_visible_sidebar_tab(target_panel_identifier_string) {
    const array_of_tab_button_elements = document.querySelectorAll('.sidebar-tab');
    const array_of_tab_panel_elements = document.querySelectorAll('.tab-panel');
    
    array_of_tab_button_elements.forEach(current_tab_button_element => {
      current_tab_button_element.classList.toggle('active', current_tab_button_element.dataset.tab === target_panel_identifier_string);
    });
    array_of_tab_panel_elements.forEach(current_panel_element => {
      current_panel_element.classList.toggle('active', current_panel_element.id === target_panel_identifier_string);
    });
  }

  // WHAT: Updating the grid sliders when the math module automatically guesses the best grid size.
  // WHY: If the math module changes the rows and cols to 30x20 behind the scenes, we need to update the UI sliders so they don't still say 10x10.
  function recalculate_automatic_grid_fit_extents() {
    if (!CanvasSketch.hasImage()) return;
    const source_image_dimensions_object = CanvasSketch.getSourceDimensions();
    const auto_calculated_grid_fit_dimensions = Grid.autoFit(source_image_dimensions_object.width, source_image_dimensions_object.height, shared_global_grid_configuration);
    
    shared_global_grid_configuration.total_grid_columns = auto_calculated_grid_fit_dimensions.total_calculated_columns;
    shared_global_grid_configuration.total_grid_rows = auto_calculated_grid_fit_dimensions.total_calculated_rows;
    
    document.getElementById('ctrl-cols').value = auto_calculated_grid_fit_dimensions.total_calculated_columns;
    document.getElementById('ctrl-rows').value = auto_calculated_grid_fit_dimensions.total_calculated_rows;
    document.getElementById('val-cols').textContent = auto_calculated_grid_fit_dimensions.total_calculated_columns;
    document.getElementById('val-rows').textContent = auto_calculated_grid_fit_dimensions.total_calculated_rows;
  }

  function convert_radians_to_degrees(radians_float) { return Math.round(radians_float * 180 / Math.PI); }
  function convert_degrees_to_radians(degrees_float) { return degrees_float * Math.PI / 180; }

  function update_status_bar_message_text(new_status_message_string) {
    const status_message_text_element = document.getElementById('status-message');
    if (status_message_text_element) status_message_text_element.textContent = new_status_message_string;
  }

  /* ---- Toast notifications ---- */

  // WHAT: Showing a temporary popup message at the bottom of the screen.
  // WHY: Provides non-intrusive feedback for actions like successfully exporting or clearing tiles.
  function trigger_floating_toast_notification(message_string, notification_type_string = 'success') {
    const toast_container_element = document.querySelector('.toast-container');
    if (!toast_container_element) return;

    const toast_div_element = document.createElement('div');
    toast_div_element.className = `toast ${notification_type_string}`;
    toast_div_element.textContent = message_string;
    toast_container_element.appendChild(toast_div_element);

    setTimeout(() => {
      toast_div_element.style.animation = `toastOut var(--transition-base) ease forwards`;
      toast_div_element.addEventListener('animationend', () => toast_div_element.remove());
    }, 3000);
  }

  // WHAT: Registering window-level keyboard event listeners to capture arrow key presses.
  // WHY: The user wants to adjust the grid's origin offset using the keyboard arrow keys. We listen globally so that they can press these keys at any time. We also ensure that we do not intercept the key events if the user is currently typing into an input field, select box, or textarea, to preserve standard browser form interaction.
  function initialize_keyboard_event_listeners() {
    window.addEventListener('keydown', (keyboard_press_event) => {
      // WHAT: Checking if the user is currently focused on an interactive input element.
      // WHY: If they are typing in an input box or selecting from a dropdown, pressing the arrow keys should move the text cursor or change the dropdown selection, not move the grid.
      const currently_active_html_element = document.activeElement;
      if (currently_active_html_element) {
        const active_element_tag_name = currently_active_html_element.tagName.toLowerCase();
        if (active_element_tag_name === 'input' || active_element_tag_name === 'textarea' || active_element_tag_name === 'select') {
          return;
        }
      }

      // WHAT: Determining which arrow key was pressed and adjusting the corresponding offset.
      // WHY: Left/Right arrow keys change the horizontal offset, and Up/Down arrow keys change the vertical offset. Holding down the Shift key allows for faster movement (e.g. 10 pixels instead of 1 pixel per keypress).
      let was_grid_origin_modified = false;
      const pixel_shift_amount = keyboard_press_event.shiftKey ? 10 : 1;

      if (keyboard_press_event.key === 'ArrowLeft') {
        shared_global_grid_configuration.grid_origin_offset_x_pixels -= pixel_shift_amount;
        was_grid_origin_modified = true;
      } else if (keyboard_press_event.key === 'ArrowRight') {
        shared_global_grid_configuration.grid_origin_offset_x_pixels += pixel_shift_amount;
        was_grid_origin_modified = true;
      } else if (keyboard_press_event.key === 'ArrowUp') {
        shared_global_grid_configuration.grid_origin_offset_y_pixels -= pixel_shift_amount;
        was_grid_origin_modified = true;
      } else if (keyboard_press_event.key === 'ArrowDown') {
        shared_global_grid_configuration.grid_origin_offset_y_pixels += pixel_shift_amount;
        was_grid_origin_modified = true;
      }

      // WHAT: Updating the canvas and UI if the origin was modified.
      // WHY: If a change occurred, we must push the updated configuration to the CanvasSketch renderer so it redraws the grid instantly, and update the UI sliders so they stay synchronized. We also prevent the default scrolling behavior of the arrow keys.
      if (was_grid_origin_modified) {
        keyboard_press_event.preventDefault();
        CanvasSketch.setGridConfig(shared_global_grid_configuration);
        synchronize_grid_origin_sliders_with_configuration_state();
      }
    });
  }

  // WHAT: Syncing the visual sliders for the grid origin X and Y offsets with the current state values.
  // WHY: When the user adjusts the origin using keyboard shortcuts (like arrow keys), the state values change under the hood. We must update the HTML sliders and text labels so the sidebar UI matches the new state.
  function synchronize_grid_origin_sliders_with_configuration_state() {
    const slider_element_for_origin_x = document.getElementById('ctrl-originX');
    if (slider_element_for_origin_x) {
      slider_element_for_origin_x.value = shared_global_grid_configuration.grid_origin_offset_x_pixels;
    }
    const label_element_for_origin_x = document.getElementById('val-originX');
    if (label_element_for_origin_x) {
      label_element_for_origin_x.textContent = `${shared_global_grid_configuration.grid_origin_offset_x_pixels}px`;
    }

    const slider_element_for_origin_y = document.getElementById('ctrl-originY');
    if (slider_element_for_origin_y) {
      slider_element_for_origin_y.value = shared_global_grid_configuration.grid_origin_offset_y_pixels;
    }
    const label_element_for_origin_y = document.getElementById('val-originY');
    if (label_element_for_origin_y) {
      label_element_for_origin_y.textContent = `${shared_global_grid_configuration.grid_origin_offset_y_pixels}px`;
    }
  }

  // WHAT: Wiring up the global Reset All button in the header.
  // WHY: The user wants a way to completely clear the page and start over without reloading the browser tab. We must reset the grid math, clear the canvas, wipe all exported tiles, destroy collision data, and update the HTML sliders to match the defaults.
  function initialize_global_reset_button() {
    const reset_all_button_element = document.getElementById('btn-reset');
    if (!reset_all_button_element) return;

    reset_all_button_element.addEventListener('click', () => {
      // 1. Reset Canvas State
      CanvasSketch.reset();
      
      // 2. Clear Extracted Tiles and Extraction Sets
      array_of_all_extracted_tiles = [];
      array_of_all_extraction_sets = [];
      currently_active_tile_identifier_string = null;
      rebuild_and_render_tile_gallery_user_interface();
      
      // 3. Destroy Collision Database
      Collision.clear();
      
      // 4. Restore Grid Defaults
      Object.assign(shared_global_grid_configuration, Grid.defaults());
      CanvasSketch.setGridConfig(shared_global_grid_configuration);
      
      // 5. Synchronize UI Sliders and Inputs
      document.getElementById('ctrl-cellW').value = shared_global_grid_configuration.cell_width_pixels;
      document.getElementById('val-cellW').textContent = shared_global_grid_configuration.cell_width_pixels;
      
      document.getElementById('ctrl-cellH').value = shared_global_grid_configuration.cell_height_pixels;
      document.getElementById('val-cellH').textContent = shared_global_grid_configuration.cell_height_pixels;
      
      document.getElementById('ctrl-shearX').value = 0;
      document.getElementById('val-shearX').textContent = '0°';
      
      document.getElementById('ctrl-shearY').value = 0;
      document.getElementById('val-shearY').textContent = '0°';
      
      document.getElementById('ctrl-cols').value = shared_global_grid_configuration.total_grid_columns;
      document.getElementById('val-cols').textContent = shared_global_grid_configuration.total_grid_columns;
      
      document.getElementById('ctrl-rows').value = shared_global_grid_configuration.total_grid_rows;
      document.getElementById('val-rows').textContent = shared_global_grid_configuration.total_grid_rows;

      synchronize_grid_origin_sliders_with_configuration_state();

      // 6. Reset UI State
      const file_drop_zone_element = document.querySelector('.drop-zone');
      if (file_drop_zone_element) file_drop_zone_element.classList.add('empty-state');
      
      const dimensions_text_element = document.getElementById('status-dimensions');
      if (dimensions_text_element) dimensions_text_element.textContent = '—';
      
      const status_dot_element = document.getElementById('status-dot');
      if (status_dot_element) status_dot_element.className = 'status-dot warning';

      switch_visible_sidebar_tab('panel-grid');
      update_status_bar_message_text('Page reset successfully');
      trigger_floating_toast_notification('All data cleared', 'warning');
    });
  }

  return { init: execute_application_boot_sequence };
})();

/* ---- Boot ---- */
document.addEventListener('DOMContentLoaded', App.init);
