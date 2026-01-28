document.addEventListener('DOMContentLoaded', function () {
    const targetDiv = document.querySelector('div.stephen-test-script-element');

    if (targetDiv) {
        targetDiv.innerText = 'Script HAS run!';
    } else {
        console.log('Element with class "stephen-test-script-element" not found.');
    }
});