use super::{decode_pcm, encode_pcm, Request, Response};

#[test]
fn pcm_round_trip() {
    let samples = [0.0, 0.5, -1.0];
    assert_eq!(decode_pcm(&encode_pcm(&samples)).unwrap(), samples);
    assert_eq!(
        decode_pcm("zzzz").unwrap_err(),
        "pcm must be f32 little-endian"
    );
}

#[test]
fn load_and_text_use_the_worker_wire() {
    let load = Request::Load {
        model: "/models/speech".into(),
        engine: "onnx".into(),
    };
    let wire = serde_json::to_string(&load).unwrap();
    assert_eq!(serde_json::from_str::<Request>(&wire).unwrap(), load);
    let heard = Response::Text {
        text: "hello".into(),
    };
    let wire = serde_json::to_string(&heard).unwrap();
    assert_eq!(serde_json::from_str::<Response>(&wire).unwrap(), heard);

    let feed = Request::Feed {
        pcm: encode_pcm(&[0.25]),
    };
    let wire = serde_json::to_string(&feed).unwrap();
    assert_eq!(
        wire,
        format!("{{\"op\":\"feed\",\"pcm\":\"{}\"}}", encode_pcm(&[0.25]))
    );
    assert_eq!(serde_json::from_str::<Request>(&wire).unwrap(), feed);
    assert_eq!(
        serde_json::to_string(&Request::Finish).unwrap(),
        "{\"op\":\"finish\"}"
    );
    let partial = Response::Partial { text: "hel".into() };
    let wire = serde_json::to_string(&partial).unwrap();
    assert_eq!(wire, "{\"op\":\"partial\",\"text\":\"hel\"}");
    assert_eq!(serde_json::from_str::<Response>(&wire).unwrap(), partial);
}
