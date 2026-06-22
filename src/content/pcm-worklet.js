// pcm-worklet.js — AudioWorkletProcessor：把單聲道 PCM 樣本透過 port 傳回主執行緒。
// 取代已棄用的 ScriptProcessorNode。
class PCMWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      // 複製一份再傳，避免被底層 buffer 回收
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true; // 持續運作
  }
}

registerProcessor("pcm-worklet", PCMWorklet);
