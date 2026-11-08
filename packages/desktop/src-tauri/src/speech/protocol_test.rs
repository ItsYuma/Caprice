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
}
