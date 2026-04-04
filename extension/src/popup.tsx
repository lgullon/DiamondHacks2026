import "./style.css"

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "zh", label: "中文" }
]

function IndexPopup() {
  return (
    <div className="w-64 p-4 bg-white font-sans">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-3xl">🤖</span>
        <div>
          <h1 className="text-lg font-bold text-purple-700">FormBuddy</h1>
          <p className="text-xs text-gray-500">Your form assistant</p>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Navigate to a page with a form, then click <strong>Start</strong> to
        begin.
      </p>

      <button
        className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
        onClick={() => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id!, { type: "START_FORMBUDDY" })
          })
        }}>
        Start FormBuddy
      </button>
    </div>
  )
}

export default IndexPopup
