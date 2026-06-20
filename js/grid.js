/* ============================================================
   PinkTileington — Affine Grid Math Module
   Pure math: grid ↔ pixel transforms for oblique projections
   ============================================================ */

const Grid = (() => {
  'use strict';

  // WHAT: Providing a default configuration object for the grid system.
  // WHY: When the application first loads, or if a user resets their settings, we need a baseline set of mathematical constants to draw the default grid. This prevents the math functions from crashing due to undefined variables.
  const get_default_grid_configuration = () => ({
    cell_width_pixels: 64,
    cell_height_pixels: 64,
    shear_angle_x_radians: 0,
    shear_angle_y_radians: 0,
    grid_origin_offset_x_pixels: 0,
    grid_origin_offset_y_pixels: 0,
    total_grid_columns: 10,
    total_grid_rows: 10,
  });

  // WHAT: Converting logical grid coordinates (like column 2, row 3) into absolute pixel coordinates on the canvas.
  // WHY: To draw the grid overlay or figure out exactly where to slice an image, we need to mathematically transform the abstract grid grid (rows and columns) into literal X and Y pixel positions. The tangent math applies our custom oblique/isometric skew.
  function calculate_pixel_coordinates_from_grid_position(grid_column_index, grid_row_index, grid_configuration_settings) {
    // WHAT: Calculating the tangent of the X shear angle.
    // WHY: The tangent gives us the ratio of how much the X coordinate shifts horizontally for every unit of vertical movement. This creates the leaning parallelogram effect.
    const tangent_of_shear_x = Math.tan(grid_configuration_settings.shear_angle_x_radians);
    
    // WHAT: Calculating the tangent of the Y shear angle.
    // WHY: Similar to X, the tangent here dictates how much the Y coordinate drops or rises as we move across columns.
    const tangent_of_shear_y = Math.tan(grid_configuration_settings.shear_angle_y_radians);
    
    // WHAT: Returning the final X and Y pixel coordinates.
    // WHY: We multiply the column and row by the cell dimensions to get the base position, then add the shear offsets to apply the perspective. Finally, we add the global origin offset to position the entire grid in world space.
    return {
      x_coordinate: grid_configuration_settings.grid_origin_offset_x_pixels + (grid_column_index * grid_configuration_settings.cell_width_pixels) + (grid_row_index * grid_configuration_settings.cell_width_pixels * tangent_of_shear_x),
      y_coordinate: grid_configuration_settings.grid_origin_offset_y_pixels + (grid_row_index * grid_configuration_settings.cell_height_pixels) + (grid_column_index * grid_configuration_settings.cell_height_pixels * tangent_of_shear_y),
    };
  }

  // WHAT: Converting absolute pixel coordinates back into logical grid coordinates (columns and rows).
  // WHY: When a user clicks their mouse on the screen, the browser only gives us pixel coordinates. We need to do the math in reverse to figure out which specific grid cell they clicked inside of. This is an inverse kinematics problem solved via a linear system equation.
  function calculate_grid_position_from_pixel_coordinates(pixel_x_coordinate, pixel_y_coordinate, grid_configuration_settings) {
    const tangent_of_shear_x = Math.tan(grid_configuration_settings.shear_angle_x_radians);
    const tangent_of_shear_y = Math.tan(grid_configuration_settings.shear_angle_y_radians);

    // WHAT: Setting up the coefficients for a 2x2 matrix equation based on Cramer's rule.
    // WHY: Because our grid is skewed, we can't just divide X by width. X and Y influence each other. A matrix determinant allows us to isolate the variables and solve the equations simultaneously.
    const matrix_coefficient_a = grid_configuration_settings.cell_width_pixels;
    const matrix_coefficient_b = grid_configuration_settings.cell_width_pixels * tangent_of_shear_x;
    const matrix_coefficient_c = grid_configuration_settings.cell_height_pixels * tangent_of_shear_y;
    const matrix_coefficient_d = grid_configuration_settings.cell_height_pixels;

    // WHAT: Calculating the determinant of our 2x2 matrix.
    // WHY: The determinant tells us if the grid has collapsed into a single line or point (which would happen if the math resulted in dividing by zero).
    const matrix_determinant = (matrix_coefficient_a * matrix_coefficient_d) - (matrix_coefficient_b * matrix_coefficient_c);
    
    // WHAT: Checking if the determinant is practically zero.
    // WHY: If it is zero, the grid is degenerate (squashed flat) and we cannot solve the equation. We return Not-A-Number to safely fail.
    if (Math.abs(matrix_determinant) < 1e-10) {
      return { grid_column_fraction: NaN, grid_row_fraction: NaN };
    }

    // WHAT: Adjusting the incoming pixel coordinates relative to the grid's global origin.
    // WHY: The matrix math assumes the grid starts at 0,0. Subtracting the origin offset normalizes the click position so the math works perfectly regardless of where the grid is panned.
    const relative_pixel_distance_x = pixel_x_coordinate - grid_configuration_settings.grid_origin_offset_x_pixels;
    const relative_pixel_distance_y = pixel_y_coordinate - grid_configuration_settings.grid_origin_offset_y_pixels;

    // WHAT: Applying Cramer's rule to solve for the column and row.
    // WHY: This returns exact fractional coordinates. For example, 1.5 means halfway across the second column.
    return {
      grid_column_fraction: ((matrix_coefficient_d * relative_pixel_distance_x) - (matrix_coefficient_b * relative_pixel_distance_y)) / matrix_determinant,
      grid_row_fraction: ((matrix_coefficient_a * relative_pixel_distance_y) - (matrix_coefficient_c * relative_pixel_distance_x)) / matrix_determinant,
    };
  }

  // WHAT: Getting the four corner vertices of a specific grid cell.
  // WHY: To draw a parallelogram border around a selected tile, or to create a clipping path for extraction, we need the exact pixel coordinates of all four corners of the cell.
  function calculate_cell_corner_quadrilateral(grid_column_index, grid_row_index, grid_configuration_settings) {
    // WHAT: Returning an array of four pixel coordinate objects representing the corners in clockwise order starting from top-left.
    // WHY: A standard winding order ensures rendering engines and clipping masks behave predictably without flipping shapes inside-out.
    return [
      calculate_pixel_coordinates_from_grid_position(grid_column_index, grid_row_index, grid_configuration_settings),
      calculate_pixel_coordinates_from_grid_position(grid_column_index + 1, grid_row_index, grid_configuration_settings),
      calculate_pixel_coordinates_from_grid_position(grid_column_index + 1, grid_row_index + 1, grid_configuration_settings),
      calculate_pixel_coordinates_from_grid_position(grid_column_index, grid_row_index + 1, grid_configuration_settings),
    ];
  }

  // WHAT: Calculating the minimum axis-aligned bounding box that entirely encapsulates a sheared cell.
  // WHY: When we extract a skewed tile, the resulting PNG image file still has to be a perfect rectangle. We need to know the absolute minimum width and height required to store the parallelogram without cutting off the corners.
  function calculate_cell_axis_aligned_bounding_box(grid_column_index, grid_row_index, grid_configuration_settings) {
    const corner_quadrilateral = calculate_cell_corner_quadrilateral(grid_column_index, grid_row_index, grid_configuration_settings);
    
    // WHAT: Extracting just the X and Y coordinates into their own lists.
    // WHY: This makes it easier to use math functions to find the absolute smallest and largest values.
    const all_x_coordinates = corner_quadrilateral.map(polygon_vertex_point => polygon_vertex_point.x_coordinate);
    const all_y_coordinates = corner_quadrilateral.map(polygon_vertex_point => polygon_vertex_point.y_coordinate);
    
    const minimum_x_coordinate = Math.min(...all_x_coordinates);
    const minimum_y_coordinate = Math.min(...all_y_coordinates);
    const maximum_x_coordinate = Math.max(...all_x_coordinates);
    const maximum_y_coordinate = Math.max(...all_y_coordinates);
    
    return { 
      bounding_box_x_position: minimum_x_coordinate, 
      bounding_box_y_position: minimum_y_coordinate, 
      bounding_box_width: maximum_x_coordinate - minimum_x_coordinate, 
      bounding_box_height: maximum_y_coordinate - minimum_y_coordinate 
    };
  }

  // WHAT: Determining which specific, whole-number grid cell contains a pixel coordinate.
  // WHY: When a user clicks the screen, the inverse math gives us fractional coordinates (like 1.2, 3.8). We need to round these down to find the discrete cell (1, 3) the user actually clicked. If they clicked outside the defined grid area, we return nothing.
  function perform_pixel_hit_test_against_grid(pixel_x_coordinate, pixel_y_coordinate, grid_configuration_settings) {
    const fractional_grid_position = calculate_grid_position_from_pixel_coordinates(pixel_x_coordinate, pixel_y_coordinate, grid_configuration_settings);
    
    // WHAT: Flooring the fractional coordinates.
    // WHY: A coordinate of 1.9 is still technically inside column 1. Flooring ensures we snap to the correct whole-number cell index.
    const integer_column_index = Math.floor(fractional_grid_position.grid_column_fraction);
    const integer_row_index = Math.floor(fractional_grid_position.grid_row_fraction);
    
    // WHAT: Checking if the snapped cell index is outside the bounds of our configured total columns and rows.
    // WHY: We don't want users selecting invisible cells out in the void. If it's out of bounds, we return null so the system knows nothing valid was clicked.
    if (integer_column_index < 0 || integer_column_index >= grid_configuration_settings.total_grid_columns || integer_row_index < 0 || integer_row_index >= grid_configuration_settings.total_grid_rows) {
      return null;
    }
    
    return { grid_column_index: integer_column_index, grid_row_index: integer_row_index };
  }

  // WHAT: Finding the exact dead-center pixel coordinate of a cell.
  // WHY: This is extremely useful for calculating the "anchor" point of a sprite. When importing into a game engine, knowing the center of the base allows sprites to be drawn exactly at their feet, which is standard for isometric games.
  function calculate_cell_center_pixel_coordinate(grid_column_index, grid_row_index, grid_configuration_settings) {
    return calculate_pixel_coordinates_from_grid_position(grid_column_index + 0.5, grid_row_index + 0.5, grid_configuration_settings);
  }

  // WHAT: Automatically guessing how many columns and rows are needed to cover an entire image.
  // WHY: When a user first loads a massive spritesheet, it's tedious for them to manually guess the grid dimensions. We calculate the grid position of the image's far corners to automatically snap the grid size to perfectly encompass the image area.
  function auto_calculate_grid_extents_to_fit_image(source_image_width_pixels, source_image_height_pixels, grid_configuration_settings) {
    const bottom_right_corner_grid_position = calculate_grid_position_from_pixel_coordinates(source_image_width_pixels, source_image_height_pixels, grid_configuration_settings);
    const top_right_corner_grid_position = calculate_grid_position_from_pixel_coordinates(source_image_width_pixels, 0, grid_configuration_settings);
    const bottom_left_corner_grid_position = calculate_grid_position_from_pixel_coordinates(0, source_image_height_pixels, grid_configuration_settings);

    // WHAT: Finding the absolute maximum column and row needed from the corners we tested.
    // WHY: Because the grid might be sheared heavily, the bottom-right pixel corner might actually not represent the furthest grid cell. We check all extreme corners to find the true bounding limit in grid space.
    const maximum_required_columns = Math.ceil(Math.max(bottom_right_corner_grid_position.grid_column_fraction, top_right_corner_grid_position.grid_column_fraction, bottom_left_corner_grid_position.grid_column_fraction, 1));
    const maximum_required_rows = Math.ceil(Math.max(bottom_right_corner_grid_position.grid_row_fraction, top_right_corner_grid_position.grid_row_fraction, bottom_left_corner_grid_position.grid_row_fraction, 1));

    // WHAT: Returning the calculated bounds, but capping them at a hard limit.
    // WHY: If the math goes crazy (e.g. from an extreme shear angle), a grid of 10,000x10,000 would crash the browser when we try to draw it. We cap it at 200x200 for safety.
    return {
      total_calculated_columns: Math.min(maximum_required_columns, 200),
      total_calculated_rows: Math.min(maximum_required_rows, 200),
    };
  }

  // WHAT: Generating a unique string identifier for a specific cell coordinate.
  // WHY: In order to store collision data or extracted tiles in a dictionary/map, we need a reliable, unique string key to represent the specific coordinate (e.g., "tile_0_1").
  function generate_unique_tile_identifier_string(grid_column_index, grid_row_index) {
    return `tile_${grid_column_index}_${grid_row_index}`;
  }

  return {
    defaults: get_default_grid_configuration,
    gridToPixel: calculate_pixel_coordinates_from_grid_position,
    pixelToGrid: calculate_grid_position_from_pixel_coordinates,
    getCellQuad: calculate_cell_corner_quadrilateral,
    getCellBounds: calculate_cell_axis_aligned_bounding_box,
    hitTest: perform_pixel_hit_test_against_grid,
    getCellCenter: calculate_cell_center_pixel_coordinate,
    autoFit: auto_calculate_grid_extents_to_fit_image,
    tileId: generate_unique_tile_identifier_string,
  };
})();
