use super::parked_origin;

#[test]
fn the_page_stays_off_the_work_area() {
    assert_eq!(parked_origin(), (-32_000, -32_000));
}
