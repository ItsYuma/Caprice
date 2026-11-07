use super::with_resident;

#[test]
fn model_stays_loaded_across_requests() {
    let mut slot = None;
    let mut loads = 0;
    let first = with_resident(
        &mut slot,
        || {
            loads += 1;
            Ok(7_u8)
        },
        |model| Ok(model.to_string()),
    )
    .unwrap();
    let second = with_resident(
        &mut slot,
        || {
            loads += 1;
            Ok(9_u8)
        },
        |model| Ok(model.to_string()),
    )
    .unwrap();
    assert_eq!(first, "7");
    assert_eq!(second, "7");
    assert_eq!(loads, 1);
}

#[test]
fn a_failed_load_does_not_stick() {
    let mut slot: Option<u8> = None;
    let err = with_resident(
        &mut slot,
        || Err("CAPRICE_STT_MODEL is not set".to_string()),
        |model| Ok(*model),
    )
    .unwrap_err();
    assert_eq!(err, "CAPRICE_STT_MODEL is not set");
    assert!(slot.is_none());
}
