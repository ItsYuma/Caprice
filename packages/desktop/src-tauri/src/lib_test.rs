use super::companion_origin;

#[test]
fn companion_opens_at_the_top_left_of_the_work_area() {
    assert_eq!(companion_origin(0, 0), (24, 24));
    assert_eq!(companion_origin(80, 40), (104, 64));
    assert_eq!(companion_origin(-1920, 100), (-1896, 124));
}
