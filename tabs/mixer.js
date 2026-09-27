'use strict';

import MSPChainerClass from './../js/msp/MSPchainer';
import mspHelper from './../js/msp/MSPHelper';
import MSPCodes from './../js/msp/MSPCodes';
import MSP from './../js/msp';
import GUI from './../js/gui';
import FC from './../js/fc';
import i18n from './../js/localization';
import { mixer, platform, PLATFORM, INPUT, STABILIZED } from './../js/model';
import Settings from './../js/settings';
import jBox from 'jbox';
import interval from './../js/intervals';
import ServoMixRule from './../js/servoMixRule';
import { getServoTargetWarning } from './../js/servoMixerTargetWarning';
import MotorMixRule from './../js/motorMixRule';
import BitHelper from './../js/bitHelper';

const mixerTab = {};

mixerTab.initialize = function (callback, scrollPosition) {

    let loadChainer = new MSPChainerClass(),
        saveChainer = new MSPChainerClass(),
        currentPlatform,
        currentMixerPreset,
        loadedMixerPresetID,
        $servoMixTable,
        $servoMixTableBody,
        $motorMixTable,
        $motorMixTableBody,
        modal,
        motorWizardModal,
        servoTargetWarningModal;

    if (GUI.active_tab !== this) {
        GUI.active_tab = this;
    }

    loadChainer.setChain([
        mspHelper.loadMixerConfig,
        mspHelper.loadMiscV2,
        mspHelper.loadFeatures,
        mspHelper.loadAdvancedConfig,
        mspHelper.loadMotors,
        mspHelper.loadServoMixRules,
        mspHelper.loadMotorMixRules,
        mspHelper.loadOutputMappingExt,
        mspHelper.loadTimerOutputModes,
        mspHelper.loadLogicConditions,
        mspHelper.loadEzTune,
    ]);
    loadChainer.setExitPoint(loadHtml);
    loadChainer.execute();

    saveChainer.setChain([
        mspHelper.saveMixerConfig,
        mspHelper.sendServoMixer,
        mspHelper.sendMotorMixer,
        mspHelper.sendTimerOutputModes,
        saveSettings,
        mspHelper.saveToEeprom
    ]);
    saveChainer.setExitPoint(reboot);

    function saveSettings(onComplete) {
        Settings.saveInputs(onComplete);
    }

    function reboot() {
        //noinspection JSUnresolvedVariable
        GUI.log(i18n.getMessage('configurationEepromSaved'));

        GUI.tab_switch_cleanup(function() {
            MSP.send_message(MSPCodes.MSP_SET_REBOOT, false, false, reinitialize);
        });
    }

    function reinitialize() {
        //noinspection JSUnresolvedVariable
        GUI.log(i18n.getMessage('deviceRebooting'));
        GUI.handleReconnect($('.tab_mixer a'));
    }

    function loadHtml() {
        import('./mixer.html?raw').then(({default: html}) => GUI.load(html, Settings.processHtml(processHtml)));
    }

    function buildTimerGroups(outputCount) {
        const groups = [];
        for (let i = 0; i < outputCount; i++) {
            const timerId = FC.OUTPUT_MAPPING.getTimerId(i);
            const color = FC.OUTPUT_MAPPING.getOutputTimerColor(i);
            if (groups.length > 0 && groups.at(-1).timerId === timerId) {
                groups.at(-1).count++;
            } else {
                groups.push({ timerId, count: 1, color });
            }
        }
        return groups;
    }

    function buildTimerSelectHtml(group) {
        const O = FC.OUTPUT_MAPPING;
        const usageMode = O.getTimerOverride(group.timerId) ?? O.TIMER_OUTPUT_MODE_AUTO;
        let displayMode = usageMode;
        if (usageMode === O.TIMER_OUTPUT_MODE_AUTO) {
            if (O.isTimerDefaultLed(group.timerId))         displayMode = O.TIMER_OUTPUT_MODE_LED;
            else if (O.isTimerDefaultBeeper(group.timerId)) displayMode = O.TIMER_OUTPUT_MODE_BEEPER;
        }
        const optionsHtml = [
            [O.TIMER_OUTPUT_MODE_AUTO,   'AUTO'],
            [O.TIMER_OUTPUT_MODE_MOTORS, 'MOTORS'],
            [O.TIMER_OUTPUT_MODE_SERVOS, 'SERVOS'],
            [O.TIMER_OUTPUT_MODE_LED,    'LED'],
            [O.TIMER_OUTPUT_MODE_PINIO,  'PINIO / PWM'],
            [O.TIMER_OUTPUT_MODE_BEEPER, 'BEEPER'],
        ].map(([value, label]) =>
            '<option value=' + value + (displayMode === value ? ' selected' : '') + '>' + label + '</option>'
        ).join('');
        return 'Timer&nbsp;' + (group.timerId + 1) + ' <select id="timer-output-' + group.timerId + '">' + optionsHtml + '</select>';
    }

    function renderOutputTable() {
        const outputCount = FC.OUTPUT_MAPPING.getOutputCount();
        const $timerRow = $('#timer-row');
        const $outputRow = $('#output-row');
        const $functionRow = $('#function-row');

        $timerRow.append('<th></th>');
        $outputRow.append('<th data-i18n="mappingTableOutput"></th>');
        $functionRow.append('<th data-i18n="mappingTableFunction"></th>');

        const groups = buildTimerGroups(outputCount);

        for (const group of groups) {
            const selectHtml = buildTimerSelectHtml(group);
            $timerRow.append('<td colspan="' + group.count + '" style="background-color: ' + group.color + '; padding-right: 4px">' + selectHtml + '</td>');
        }

        for (let i = 1; i <= outputCount; i++) {
            const color = FC.OUTPUT_MAPPING.getOutputTimerColor(i - 1);
            const isLed = FC.OUTPUT_MAPPING.isLedPin(i - 1);
            const isBeeper = FC.OUTPUT_MAPPING.isBeeperPin(i - 1);
            $outputRow.append('<td style="background-color: ' + color + '">S' + i + (isLed ? '/LED' : '') + (isBeeper ? '/Buzzer' : '') + '</td>');
            $functionRow.append('<td id="function-' + i + '">-</td>');
        }

        $outputRow.find('td').css('width', 100 / (outputCount + 1) + '%');

        for (const group of groups) {
            $('#timer-output-' + group.timerId).on('change', function() {
                updateTimerOverride();
                if (FC.OUTPUT_MAPPING.hasDirectAssignment()) {
                    mspHelper.queryOutputAssignment(renderOutputMapping);
                } else {
                    renderOutputMapping();
                }
            });
        }
    }

    function updateTimerOverride() {
        let timers = FC.OUTPUT_MAPPING.getUsedTimerIds();

        for(let i = 0; i < timers.length; ++i) {
            let timerId = timers[i];
            let $select = $('#timer-output-' + timerId);
            if(!$select) {
                continue;
            }
            FC.OUTPUT_MAPPING.setTimerOverride(timerId, $select.val());
        }
    }

    function renderOutputMapping() {
        let isMR = FC.MIXER_CONFIG.platformType == PLATFORM.MULTIROTOR || FC.MIXER_CONFIG.platformType == PLATFORM.TRICOPTER;
        let jsMap = FC.OUTPUT_MAPPING.getOutputTable(isMR, FC.MOTOR_RULES.getNumberOfConfiguredMotors(), FC.SERVO_RULES.getUsedServoIndexes());
        let outputMap;
        if (FC.OUTPUT_MAPPING.hasDirectAssignment()) {
            outputMap = FC.OUTPUT_MAPPING.getOutputTableDirect();
            for (let i = 0; i < Math.min(outputMap.length, jsMap.length); i++) {
                if (outputMap[i] === '-' && jsMap[i] && jsMap[i] !== '-') outputMap[i] = jsMap[i]; // fill in default LED and beeper
            }
        } else {
            outputMap = jsMap;
        }

        for (let i = 1; i <= FC.OUTPUT_MAPPING.getOutputCount(); i++) {
            $('#function-' + i).html(outputMap[i - 1]);
        }

        renderServoOutputImage(outputMap);
    }

    function renderServoOutputImage(outputMap) {
        let mixerPreview = $('.mixerPreview');
        mixerPreview.find('.outputImageNumber').remove();

        $(".mix-rule-servo").each(function() {
            $(this).css("background-color", "");
            $(this).css("font-weight", "");
            $(this).css("color", "");
        });

        if (FC.MIXER_CONFIG.platformType == PLATFORM.AIRPLANE) {
            if (outputMap != null && currentMixerPreset.hasOwnProperty('imageOutputsNumbers')) {
                let outputPad = 1;
                let outputArea = null;
                let inputBoxes = null;
                let surfaces = {
                    aileronSet: mixer.countSurfaceType(currentMixerPreset, INPUT.STABILIZED_ROLL),
                    elevatorSet: mixer.countSurfaceType(currentMixerPreset, INPUT.STABILIZED_PITCH),
                    rudderSet: mixer.countSurfaceType(currentMixerPreset, INPUT.STABILIZED_YAW),
                };
                let motors = [];
                let servoRules = FC.SERVO_RULES;

                for (let omIndex of outputMap) {
                    if (omIndex != '-') {
                        omIndex = omIndex.split(' ');
                        if (omIndex[0] == "Motor") {
                            motors.push(outputPad);
                        } else {
                            let servo = servoRules.getServoMixRuleFromTarget(omIndex[1]);
                            if (servo == null) {continue;}
                            let divID = "servoPreview" + omIndex[1];
                            
                            switch (parseInt(servo.getInput())) {
                                case INPUT.STABILIZED_PITCH:
                                case STABILIZED.PITCH_POSITIVE:
                                case STABILIZED.PITCH_NEGATIVE:
                                case INPUT.RC_PITCH:
                                    outputArea = getOutputImageArea(currentMixerPreset.imageOutputsNumbers, INPUT.STABILIZED_PITCH, surfaces.elevatorSet);
                                    if (outputArea != null) {
                                        mixerPreview.append('<div id="' + divID + '" class="outputImageNumber">S' + outputPad + '</div>');

                                        $("#"+divID).css("top", outputArea.top + "px");
                                        $("#"+divID).css("left", outputArea.left + "px");
                                        $("#"+divID).css("border-color", outputArea.colour);

                                        inputBoxes = getServoNumberInput(servo.getTarget());
                                        if (inputBoxes.length > 0) {
                                            $.each(inputBoxes, function() {
                                                $(this).css("background-color", outputArea.colour);
                                                $(this).css("font-weight", "bold");
                                                $(this).css("color", "#FFFFFF");
                                            });
                                        }

                                        surfaces.elevatorSet--;
                                    }
                                    break;
                                case INPUT.STABILIZED_ROLL:
                                case STABILIZED.ROLL_POSITIVE:
                                case STABILIZED.ROLL_NEGATIVE:
                                case INPUT.RC_ROLL:
                                    outputArea = getOutputImageArea(currentMixerPreset.imageOutputsNumbers, INPUT.STABILIZED_ROLL, surfaces.aileronSet);
                                    if (outputArea != null) {
                                        mixerPreview.append('<div id="' + divID + '" class="outputImageNumber">S' + outputPad + '</div>');

                                        $("#"+divID).css("top", outputArea.top + "px");
                                        $("#"+divID).css("left", outputArea.left + "px");
                                        $("#"+divID).css("border-color", outputArea.colour);

                                        inputBoxes = getServoNumberInput(servo.getTarget());
                                        if (inputBoxes.length > 0) {
                                            $.each(inputBoxes, function() {
                                                $(this).css("background-color", outputArea.colour);
                                                $(this).css("font-weight", "bold");
                                                $(this).css("color", "#FFFFFF");
                                            });
                                        }

                                        surfaces.aileronSet--;
                                    }
                                    break;
                                case INPUT.STABILIZED_YAW:
                                case STABILIZED.YAW_POSITIVE:
                                case STABILIZED.YAW_NEGATIVE:
                                case INPUT.RC_YAW:
                                    outputArea = getOutputImageArea(currentMixerPreset.imageOutputsNumbers, INPUT.STABILIZED_YAW, surfaces.rudderSet);
                                    if (outputArea != null) {
                                        mixerPreview.append('<div id="' + divID + '" class="outputImageNumber">S' + outputPad + '</div>');

                                        $("#"+divID).css("top", outputArea.top + "px");
                                        $("#"+divID).css("left", outputArea.left + "px");
                                        $("#"+divID).css("border-color", outputArea.colour);

                                        inputBoxes = getServoNumberInput(servo.getTarget());
                                        if (inputBoxes.length > 0) {
                                            $.each(inputBoxes, function() {
                                                $(this).css("background-color", outputArea.colour);
                                                $(this).css("font-weight", "bold");
                                                $(this).css("color", "#FFFFFF");
                                            });
                                        }

                                        surfaces.rudderSet--;
                                    }
                                    break;
                            }
                        }
                    }

                    outputPad++;
                }

                if (motors.length > 0) {
                    mixerPreview.append('<div id="motorsPreview" class="outputImageNumber isMotor">S' + motors.join('/') + '</div>');

                    outputArea = getOutputImageArea(currentMixerPreset.imageOutputsNumbers, INPUT.STABILIZED_THROTTLE, 0);
                    if (outputArea != null) {
                        $("#motorsPreview").css("top", outputArea.top + "px");
                        $("#motorsPreview").css("left", outputArea.left + "px");
                        $("#motorsPreview").css("border-color", outputArea.colour);
                    }
                }
            }
        }
    }

    var lastRoll = -1;
    var lastPitch = -1;
    var lastYaw = -1;

    function getOutputImageArea(outputImageAreas, input, surfacesSet) {
        let returnArea = null;
        
        for (let area of outputImageAreas) {
            if (area.input == input) {
                if ( input === INPUT.STABILIZED_THROTTLE
                    || (surfacesSet > 0 && 
                            ((input === INPUT.STABILIZED_YAW && surfacesSet !== lastYaw) 
                            || (input === INPUT.STABILIZED_ROLL && surfacesSet !== lastRoll) 
                            || (input === INPUT.STABILIZED_PITCH && surfacesSet !== lastPitch))
                        )
                ) {
                    returnArea = area;
                }

                if (input === INPUT.STABILIZED_ROLL) {
                    lastRoll = surfacesSet-1;
                } else if (input === INPUT.STABILIZED_PITCH) {
                    lastPitch = surfacesSet-1;
                } else if (input === INPUT.STABILIZED_YAW) {
                    lastYaw = surfacesSet-1;
                }

                if (returnArea !== null) {
                    break;
                }
            }
        }

        return returnArea;
    }

    function getServoNumberInput(target) {
        let servoInputs = [];

        $(".mix-rule-servo").each(function() {
            if ($(this).val() == target) {
                servoInputs.push($(this));
            }
        });

        return servoInputs;
    }

    function renderServoMixRules() {
        /*
         * Process servo mix table UI
         */
        let rules = FC.SERVO_RULES.get();
        $servoMixTableBody.find("*").remove();
        for (let servoRuleIndex in rules) {
            if (rules.hasOwnProperty(servoRuleIndex)) {
                const servoRule = rules[servoRuleIndex];

                $servoMixTableBody.append('\
                    <tr>\
                    <td><input type="number" class="mix-rule-servo" step="1" min="0" max="15" /></td>\
                    <td><select class="mix-rule-input"></select></td>\
                    <td class="mixer-fixed-value-col"><input type="number" class="mix-rule-fixed-value" min="875" max="2125" disabled /></td> \
                    <td><input type="number" class="mix-rule-rate" step="1" min="-125" max="125" /></td>\
                    <td><input type="number" class="mix-rule-speed" step="1" min="0" max="255" /></td>\
                    <td class="mixer-table__condition"></td>\
                    <td><span class="btn default_btn narrow red"><a href="#" data-role="role-servo-delete" data-i18n="servoMixerDelete"></a></span></td>\
                    </tr>\
                ');

                const $row = $servoMixTableBody.find('tr:last');

                GUI.renderLogicConditionSelect(
                    $row.find('.mixer-table__condition'), 
                    FC.LOGIC_CONDITIONS, 
                    servoRule.getConditionId(), 
                    function () {
                        servoRule.setConditionId($(this).val());
                    },
                    true,
                    true
                );

                GUI.fillSelect($row.find(".mix-rule-input"), FC.getServoMixInputNames(), servoRule.getInput());

                if (!FC.MIXER_CONFIG.hasFlaps) {
                    $row.find(".mix-rule-input").children('option[value="14"]').remove();
                }

                $row.find(".mix-rule-input").val(servoRule.getInput()).on('change', function () {
                    servoRule.setInput($(this).val());
                    updateFixedValueVisibility($row, $(this));

                    renderOutputMapping();
                });

                $row.find(".mix-rule-servo").val(servoRule.getTarget()).on('change', function () {
                    const enteredTarget = Number($(this).val());

                    servoRule.setTarget(enteredTarget);

                    const warning = getServoTargetWarning(FC.SERVO_RULES.get(), enteredTarget);
                    if (warning) {
                        $('#servoTargetWarningContent .servo-target-warning-text')
                            .html(i18n.getMessage('servoMixRuleInvalidServoTarget', [warning.ruleCount, warning.enteredTarget]));
                        servoTargetWarningModal.open();
                    }
                });

                $row.find(".mix-rule-rate").val(servoRule.getRate()).on('change', function () {
                    servoRule.setRate($(this).val());
                    $row.find(".mix-rule-fixed-value").val(mapServoWeightToFixedValue($(this).val()));
                });

                $row.find(".mix-rule-fixed-value").val(mapServoWeightToFixedValue($row.find(".mix-rule-rate").val()));

                $row.find(".mix-rule-speed").val(servoRule.getSpeed()).on('change', function () {
                    servoRule.setSpeed($(this).val());
                });

                $row.find("[data-role='role-servo-delete']").attr("data-index", servoRuleIndex);

                updateFixedValueVisibility($row, $row.find(".mix-rule-input"));
            }
        }

        let rate_inputs = $('.mix-rule-rate');
        rate_inputs.attr("min", -1000);
        rate_inputs.attr("max", 1000);

       i18n.localize();;
    }

    function updateFixedValueVisibility(row, $mixRuleInput) {

        // Show the fixed value input box if "Fixed Value" input was selected for this servo
        const $fixedValueCalcInput = row.find(".mix-rule-fixed-value");
        if (FC.getServoMixInputNames()[$mixRuleInput.val()] === 'Fixed Value') {
            $fixedValueCalcInput.show();
        } else {
            $fixedValueCalcInput.hide();
            row.find(".mix-rule-speed").prop('disabled', false);
        }

        // Show the Fixed Value column if at least one servo has the "MAX" input assigned
        const $fixedValueCol = $("#servo-mix-table").find(".mixer-fixed-value-col");
        const rules = FC.SERVO_RULES.get();
        for (let servoRuleIndex in rules) {
            if (rules.hasOwnProperty(servoRuleIndex)) {
                if (FC.getServoMixInputNames()[rules[servoRuleIndex].getInput()] === 'Fixed Value') {
                    $fixedValueCol.show();
                    return;
                }
            }
        }
        $fixedValueCol.hide();
    }

    function mapServoWeightToFixedValue(weight) {
        return (parseInt(weight) + 100) * 1000 / 200 + 1000;
    }


    function labelMotorNumbers() {

        let index = 0;
        var rules;

        if (currentMixerPreset.id == loadedMixerPresetID) {
            rules = FC.MOTOR_RULES.get();
        } else {
            rules = currentMixerPreset.motorMixer;
        }

        if (currentMixerPreset.image != 'quad_x' && currentMixerPreset.image != 'quad_p') {
            for (let i = 1; i < 5; i++) {
                $("#motorNumber"+i).css("visibility", "hidden");
            }
        }

        const $img = $("#motor-mixer-preview-img");
        const imgHeight = $img.height();

        // Skip positioning if image hasn't loaded yet (height would be 0)
        if (imgHeight === 0) {
            return;
        }

        for (const i in rules) {
            if (rules.hasOwnProperty(i)) {
                const rule = rules[i];
                index++;

                if (currentMixerPreset.image != 'quad_x' && currentMixerPreset.image != 'quad_p') {
                    continue;
                }

                let top_px = 28;
                let left_px = 28;

                const roll = rule.getRoll();
                const pitch = rule.getPitch();

                if (Math.abs(roll) < 0.1) {
                    // Center horizontally (Plus: front/rear motors)
                    left_px = ($img.width() - 14) / 2;
                } else if (roll < -0.5) {
                    left_px = $img.width() - 42;
                }

                if (Math.abs(pitch) < 0.1) {
                    // Center vertically (Plus: left/right motors)
                    top_px = (imgHeight - 14) / 2;
                } else if (pitch > 0.5) {
                    top_px = imgHeight - 44;
                }

                $("#motorNumber"+index).css("left", left_px + "px");
                $("#motorNumber"+index).css("top", top_px + "px");
                $("#motorNumber"+index).removeClass("is-hidden");
                $("#motorNumber"+index).css("visibility", "visible");
            }
        }
    }


    function renderMotorMixRules() {

        /*
         * Process motor mix table UI
         */
        var rules = FC.MOTOR_RULES.get();
        $motorMixTableBody.find("*").remove();
        let index = 0;
        for (const i in rules) {
            if (rules.hasOwnProperty(i)) {
                const rule = rules[i];
                index++;

                $motorMixTableBody.append('\
                    <tr>\
                    <td><span class="mix-rule-motor"></span></td>\
                    <td>\
                        <input type="number" class="mix-rule-throttle" step="0.001" min="-2" max="2" />\
                        <div class="throttle-warning-text" data-i18n="mixerThrottleWarning" ></div>\
                    </td>\
                    <td><input type="number" class="mix-rule-roll" step="0.001" min="-2" max="2" /></td>\
                    <td><input type="number" class="mix-rule-pitch" step="0.001" min="-2" max="2" /></td>\
                    <td><input type="number" class="mix-rule-yaw" step="0.001" min="-2" max="2" /></td>\
                    <td><span class="btn default_btn narrow red"><a href="#" data-role="role-motor-delete" data-i18n="servoMixerDelete"></a></span></td>\
                    </tr>\
                ');

                const $row = $motorMixTableBody.find('tr:last');

                $row.find('.mix-rule-motor').html(index);
                const $throttleInput = $row.find('.mix-rule-throttle').val(rule.getThrottle());
                const $warningBox = $row.find('.throttle-warning-text');
    
                // Function to update throttle and show/hide warning box
                function updateThrottle() {
                    rule.setThrottle($throttleInput.val());
                    // Change color if value exceeds 1
                    if (parseFloat($throttleInput.val()) > 1 || parseFloat($throttleInput.val()) < 0) {
                        $throttleInput.css('background-color', 'orange');
                        // Show warning box
                        $warningBox.show();
                    } else {
                        $throttleInput.css('background-color', ''); // Reset to default
                        // Hide warning box
                        $warningBox.hide();
                    }
                }
                updateThrottle();
                $throttleInput.on('change', updateThrottle);

                $row.find('.mix-rule-roll').val(rule.getRoll()).on('change', function () {
                    rule.setRoll($(this).val());
                });
                $row.find('.mix-rule-pitch').val(rule.getPitch()).on('change', function () {
                    rule.setPitch($(this).val());
                });
                $row.find('.mix-rule-yaw').val(rule.getYaw()).on('change', function () {
                    rule.setYaw($(this).val());
                });
                $row.find("[data-role='role-motor-delete']").attr("data-index", i);
            }

        }
       labelMotorNumbers();
       i18n.localize();;
    }

    function saveAndReboot() {
        /*
         * Send mixer rules
         */
        FC.SERVO_RULES.cleanup();
        FC.SERVO_RULES.inflate();
        FC.MOTOR_RULES.cleanup();
        FC.MOTOR_RULES.inflate();

        updateTimerOverride();

        saveChainer.execute();
    }

    function processHtml(settingsPromise) {

        $servoMixTable = $('#servo-mix-table');
        $servoMixTableBody = $servoMixTable.find('tbody');
        $motorMixTable = $('#motor-mix-table');
        $motorMixTableBody = $motorMixTable.find('tbody');

        function fillMixerPreset() {
            let mixers = mixer.getByPlatform(FC.MIXER_CONFIG.platformType);

            $mixerPreset.find("*").remove();
            for (let i in mixers) {
                if (mixers.hasOwnProperty(i)) {
                    let m = mixers[i];
                    $mixerPreset.append('<option value="' + m.id + '">' + m.name + '</option>');
                }
            }
        }

        let $platformSelect = $('#platform-type'),
            platforms = platform.getList(),
            $mixerPreset = $('#mixer-preset'),
            $wizardButton = $("#mixer-wizard");

        motorWizardModal = new jBox('Modal', {
            width: 500,
            height: 560,
            closeButton: 'title',
            animation: false,
            attach: $wizardButton,
            title: i18n.getMessage("mixerWizardModalTitle"),
            content: $('#mixerWizardContent')
        });

        // SVG arm-tip positions (200×200 viewbox px) keyed by preset image name.
        // Index i corresponds to motorMixer[i] — the physical arm for that mixer slot.
        // Coordinates match the motor numbering shown in resources/motor_order/*.svg.
        // Presets with coaxial stacked motors (octo_x8, y4, y6) are intentionally
        // omitted — multiple motors share the same physical position, making visual
        // identification ambiguous.
        const WIZARD_MOTOR_POSITIONS = {
            'quad_x':      [{x:160,y:160},{x:160,y:40},{x:40,y:160},{x:40,y:40}],
            'quad_p':      [{x:100,y:160},{x:160,y:100},{x:40,y:100},{x:100,y:40}],
            'vtail_quad':  [{x:140,y:160},{x:160,y:40},{x:60,y:160},{x:40,y:40}],
            'atail_quad':  [{x:60,y:160},{x:160,y:40},{x:140,y:160},{x:40,y:40}],
            'hex_x':       [{x:130,y:48},{x:160,y:100},{x:130,y:152},{x:70,y:152},{x:40,y:100},{x:70,y:48}],
            'hex_p':       [{x:100,y:40},{x:152,y:70},{x:152,y:130},{x:100,y:160},{x:48,y:130},{x:48,y:70}],
            'octo_flat_x': [{x:127,y:35},{x:165,y:73},{x:165,y:127},{x:127,y:165},{x:73,y:165},{x:35,y:127},{x:35,y:73},{x:73,y:35}],
            'octo_flat_p': [{x:100,y:30},{x:150,y:51},{x:170,y:100},{x:150,y:150},{x:100,y:170},{x:51,y:150},{x:30,y:100},{x:51,y:51}],
            'tri':         [{x:100,y:160},{x:160,y:40},{x:40,y:40}],
        };

        // First digital protocol in motorPwmProtocolTypes_e (see tabs/outputs.js).
        const PROTOCOL_DSHOT150 = 4;
        // Firmware constants (INAV maintenance-10.x, flight/mixer.c): DShot maps
        // mincommand..2000 onto DSHOT 48..2047 - the upper bound is the constant
        // 2000, not max_throttle. Values below the idle threshold
        // (mincommand + throttle_idle % of that range) give DSHOT 0 = motor stopped.
        const DSHOT_MAX_VALUE = 2000;
        const DSHOT_3D_NEUTRAL = 1500;
        // Defaults used when a setting cannot be read from the FC.
        const DEFAULT_THROTTLE_IDLE_PERCENT = 8.0;     // throttle_idle (battery profile)
        const DEFAULT_3D_NEUTRAL = 1460;               // 3d_neutral
        const DEFAULT_3D_DEADBAND_THROTTLE = 50;       // 3d_deadband_throttle
        // Spin ~10 % into the usable throttle range: clearly visible, never a real spin-up.
        const WIZARD_SPIN_FRACTION = 0.10;
        // Background pollers sharing the MSP queue with the wizard; paused while it runs
        // so their traffic cannot delay a motor edge.
        const WIZARD_PAUSED_INTERVALS = ['global_data_refresh', 'logic_conditions_pull'];

        // Motor Wizard State Machine
        const wizardState = {
            currentMotor: 0,        // Which motor we're currently locating
            motorPositions: {},     // Map: motorIndex -> positionIndex
            locateInterval: null,   // Interval for repeating locate command
            isActive: false,        // Is wizard in progress?
            savedDshotBeeper: null, // Original dshot_beeper_enabled value to restore
            settingsLoaded: null,   // Promise resolved once the FC settings below are cached
            throttleIdlePercent: DEFAULT_THROTTLE_IDLE_PERCENT,
            neutral3d: DEFAULT_3D_NEUTRAL,
            deadband3dThrottle: DEFAULT_3D_DEADBAND_THROTTLE,
            pausedIntervals: []     // names actually paused by us, to resume exactly those
        };

        function isDshotProtocol() {
            return Number.parseInt(FC.ADVANCED_CONFIG.motorPwmProtocol, 10) >= PROTOCOL_DSHOT150;
        }

        function isReversibleMotors() {
            return FC.isFeatureEnabled('REVERSIBLE_MOTORS');
        }

        function clampMotorValue(value) {
            return Math.min(2000, Math.max(1000, Math.round(value)));
        }

        // Read the settings the spin/stop values depend on, once per wizard open.
        function loadWizardSettings() {
            wizardState.throttleIdlePercent = DEFAULT_THROTTLE_IDLE_PERCENT;
            wizardState.neutral3d = DEFAULT_3D_NEUTRAL;
            wizardState.deadband3dThrottle = DEFAULT_3D_DEADBAND_THROTTLE;

            function read(name, apply) {
                return mspHelper.getSetting(name).then(function (setting) {
                    if (setting && Number.isFinite(setting.value)) {
                        apply(setting.value);
                    }
                }).catch(function () {
                    // keep the default
                });
            }

            var reads = [read('throttle_idle', function (v) { wizardState.throttleIdlePercent = v; })];
            if (isDshotProtocol() && isReversibleMotors()) {
                reads.push(read('3d_neutral', function (v) { wizardState.neutral3d = v; }));
                reads.push(read('3d_deadband_throttle', function (v) { wizardState.deadband3dThrottle = v; }));
            }
            wizardState.settingsLoaded = Promise.all(reads);
            return wizardState.settingsLoaded;
        }

        // Value the firmware outputs as "motor stopped".
        //   DShot non-3D: mincommand (below the idle threshold -> DSHOT 0)
        //   DShot 3D:     3d_neutral (below 1500 + 3d_deadband_throttle -> DSHOT 0)
        //   analog:       mincommand, passed through unchanged
        function getMotorStopValue() {
            if (isDshotProtocol() && isReversibleMotors()) {
                return clampMotorValue(wizardState.neutral3d);
            }
            return clampMotorValue(FC.MISC.mincommand);
        }

        // Value that visibly twitches the motor without a real spin-up.
        //   DShot non-3D: 10 % of mincommand..2000, but at least 20 above the idle
        //                 threshold so it is never mapped to DSHOT 0 (default FC -> 1100, DSHOT ~248)
        //   DShot 3D:     10 % of the forward range above 1500 + 3d_deadband_throttle (default -> ~1595)
        //   analog:       max(throttle_idle, 10) % of mincommand..maxthrottle
        function getMotorSpinValue() {
            var min = FC.MISC.mincommand;
            var idle = wizardState.throttleIdlePercent;
            if (isDshotProtocol()) {
                if (isReversibleMotors()) {
                    var forwardStart = DSHOT_3D_NEUTRAL + wizardState.deadband3dThrottle;
                    return clampMotorValue(forwardStart + WIZARD_SPIN_FRACTION * (DSHOT_MAX_VALUE - forwardStart));
                }
                var idleThreshold = min + idle / 100 * (DSHOT_MAX_VALUE - min);
                return clampMotorValue(Math.max(min + WIZARD_SPIN_FRACTION * (DSHOT_MAX_VALUE - min), idleThreshold + 20));
            }
            return clampMotorValue(min + Math.max(idle, 10) / 100 * (FC.MISC.maxthrottle - min));
        }

        // MSP_SET_MOTOR delivery: one message in flight, one pending slot (latest wins).
        // The MSP queue rejects a second MSP_SET_MOTOR until the FC has replied and
        // MSP.send_message() would then retry the rejected one every 150 ms for
        // seconds - stale spin values reaching the FC long after a stop. So the
        // next message goes out only from the reply callback of the previous one.
        // Every stop (stop button, position click, modal close) uses this same path,
        // so a stop issued during an in-flight spin is sent right after its reply.
        var MOTOR_REPLY_TIMEOUT_MS = 500;   // lost reply: unblock and send a stop
        var motorSend = {
            inFlight: false,
            replyTimer: null,
            pending: null       // newest {motorIndex, value} not yet sent
        };

        function onMotorReply() {
            if (!motorSend.inFlight) {
                return;
            }
            clearTimeout(motorSend.replyTimer);
            motorSend.replyTimer = null;
            motorSend.inFlight = false;
            flushMotorSend();
        }

        function onMotorReplyTimeout() {
            console.log('[motor pulse] MSP_SET_MOTOR reply timed out, sending stop');
            motorSend.replyTimer = null;
            motorSend.inFlight = false;
            if (!motorSend.pending) {
                motorSend.pending = { motorIndex: -1, value: getMotorStopValue() };
            }
            flushMotorSend();
        }

        function flushMotorSend() {
            if (motorSend.inFlight || !motorSend.pending) {
                return;
            }
            var req = motorSend.pending;
            motorSend.pending = null;

            var stopValue = getMotorStopValue();
            var buffer = [];
            for (var i = 0; i < 8; i++) {
                var val = (i === req.motorIndex) ? req.value : stopValue;
                buffer.push(BitHelper.lowByte(val));
                buffer.push(BitHelper.highByte(val));
            }
            motorSend.inFlight = true;
            motorSend.replyTimer = setTimeout(onMotorReplyTimeout, MOTOR_REPLY_TIMEOUT_MS);
            var accepted = MSP.send_message(MSPCodes.MSP_SET_MOTOR, buffer, false, onMotorReply);
            if (!accepted) {
                onMotorReply();
            }
        }

        function sendMotorValues(motorIndex, value) {
            motorSend.pending = { motorIndex: motorIndex, value: value };
            flushMotorSend();
        }

        function stopMotors() {
            if (wizardState.locateInterval) {
                clearInterval(wizardState.locateInterval);
                wizardState.locateInterval = null;
            }
            sendMotorValues(-1, getMotorStopValue());  // All motors stopped
        }

        function pauseBackgroundPolling() {
            WIZARD_PAUSED_INTERVALS.forEach(function (name) {
                if (wizardState.pausedIntervals.indexOf(name) === -1 && interval.pause(name)) {
                    wizardState.pausedIntervals.push(name);
                }
            });
        }

        function resumeBackgroundPolling() {
            wizardState.pausedIntervals.forEach(function (name) {
                interval.resume(name);
            });
            wizardState.pausedIntervals = [];
        }

        function resetWizard(numMotors) {
            wizardState.currentMotor = 0;
            wizardState.motorPositions = {};
            wizardState.isActive = false;

            stopMotors();

            $('#wizard-intro').removeClass('is-hidden');
            $('#wizard-progress').addClass('is-hidden');
            $('#wizard-complete').addClass('is-hidden');

            // Regenerate progress steps for this motor count
            const $bar = $('.wizard-progress-bar').empty();
            for (let i = 0; i < numMotors; i++) {
                $bar.append(`<div class="wizard-progress-step" data-step="${i}">${i + 1}</div>`);
            }
        }

        function buildPositionButtons(positions) {
            const $preview = $('.wizard-motor-preview');
            $preview.find('.wizard-position-btn').remove();
            // Button is 36×36px; offset by half to center it on the SVG coordinate
            const HALF = 18;
            positions.forEach((pos, i) => {
                $preview.append(
                    `<div class="wizard-position-btn" id="wizardPos${i}" data-position="${i}"
                          style="left:${pos.x - HALF}px;top:${pos.y - HALF}px">
                         <span class="position-label"></span>
                     </div>`
                );
            });
        }

        function updateWizardProgress(motorIndex) {
            $('#wizard-current-motor').text(motorIndex + 1);

            $('.wizard-progress-step').each(function() {
                const step = parseInt($(this).attr('data-step'), 10);
                $(this).removeClass('active complete');
                if (step < motorIndex) {
                    $(this).addClass('complete');
                } else if (step === motorIndex) {
                    $(this).addClass('active');
                }
            });

            $('.wizard-position-btn').each(function() {
                const pos = parseInt($(this).attr('data-position'), 10);
                const isAssigned = Object.values(wizardState.motorPositions).includes(pos);
                if (!isAssigned) {
                    $(this).addClass('waiting');
                }
            });
        }

        function startMotorPulse(motorIndex) {
            // ON 300 ms, OFF 700 ms (1000 ms cycle): the pause is long enough for the
            // motor to stop completely before the next pulse. A message is sent only on
            // an edge, plus a keep-alive every 100 ms with the current value so a lost
            // message is corrected quickly and a future firmware watchdog on
            // MSP_SET_MOTOR keeps being fed. The 10 ms interval is only a clock.
            var ON_TIME = 300;
            var CYCLE = 1000;
            var KEEPALIVE_MS = 100;
            var spinValue = getMotorSpinValue();
            var stopped = getMotorStopValue();
            var startTime = Date.now();
            var lastState = true;
            var lastChange = startTime;
            var lastSentAt = startTime;

            sendMotorValues(motorIndex, spinValue);
            wizardState.locateInterval = setInterval(function() {
                var now = Date.now();
                var isOn = ((now - startTime) % CYCLE) < ON_TIME;
                var edge = isOn !== lastState;
                if (edge) {
                    console.log('[motor pulse]', isOn ? 'ON ' : 'OFF', 'after', now - lastChange, 'ms');
                    lastState = isOn;
                    lastChange = now;
                }
                if (edge || now - lastSentAt >= KEEPALIVE_MS) {
                    sendMotorValues(motorIndex, isOn ? spinValue : stopped);
                    lastSentAt = now;
                }
            }, 10);
        }

        function startLocatingMotor(motorIndex) {
            updateWizardProgress(motorIndex);
            stopMotors();
            startMotorPulse(motorIndex);
        }

        function onPositionClicked(positionIndex) {
            if (!wizardState.isActive) return;

            stopMotors();

            // Record this motor's position
            wizardState.motorPositions[wizardState.currentMotor] = positionIndex;

            // Update the button to show the motor number
            const $btn = $(`#wizardPos${positionIndex}`);
            $btn.removeClass('waiting').addClass('assigned');
            $btn.find('.position-label').text(wizardState.currentMotor + 1);

            // Remove waiting state from all buttons
            $('.wizard-position-btn').removeClass('waiting');

            // Move to next motor or complete
            wizardState.currentMotor++;

            if (wizardState.currentMotor >= currentMixerPreset.motorMixer.length) {
                // All motors identified
                wizardComplete();
            } else {
                // Start locating next motor
                startLocatingMotor(wizardState.currentMotor);
            }
        }

        function wizardComplete() {
            wizardState.isActive = false;

            // Mark all progress steps complete
            $('.wizard-progress-step').removeClass('active').addClass('complete');

            $('#wizard-progress').addClass('is-hidden');
            $('#wizard-complete').removeClass('is-hidden');
        }

        // Position button click handler — delegated so it works on dynamically generated buttons
        $('.wizard-motor-preview').on('click', '.wizard-position-btn', function() {
            if (!$(this).hasClass('waiting')) return;
            const positionIndex = parseInt($(this).attr('data-position'), 10);
            onPositionClicked(positionIndex);
        });

        // Start button click handler
        $('#wizard-start-button').on('click', function() {
            if (wizardState.isActive) return;
            wizardState.isActive = true;
            wizardState.currentMotor = 0;
            wizardState.motorPositions = {};

            $('#wizard-intro').addClass('is-hidden');
            $('#wizard-progress').removeClass('is-hidden');

            // Settings for spin/stop values were requested on open; wait for them
            (wizardState.settingsLoaded || loadWizardSettings()).then(function() {
                // Disable DShot beeper so it doesn't twitch all motors during locate
                return mspHelper.getSetting('dshot_beeper_enabled');
            }).then(function(setting) {
                if (setting) {
                    wizardState.savedDshotBeeper = setting.value;
                    if (setting.value) {
                        return new Promise(function (resolve) {
                            mspHelper.setSetting('dshot_beeper_enabled', 0, resolve);
                        });
                    }
                }
            }).catch(function() {
                // proceed anyway
            }).then(function() {
                // Keep the MSP queue free for motor edges while the wizard runs
                pauseBackgroundPolling();
                startLocatingMotor(0);
            });
        });

        // Emergency stop button click handler
        $('#wizard-stop-button').on('click', function() {
            stopMotors();
            resumeBackgroundPolling();
            motorWizardModal.close();
        });

        // Apply button click handler
        $('#wizard-apply-button').on('click', function() {
            // Build motor rules from wizard results
            FC.MOTOR_RULES.flush();

            const numMotors = currentMixerPreset.motorMixer.length;
            for (let motorIndex = 0; motorIndex < numMotors; motorIndex++) {
                const positionIndex = wizardState.motorPositions[motorIndex];
                const r = currentMixerPreset.motorMixer[positionIndex];

                FC.MOTOR_RULES.put(
                    new MotorMixRule(
                        r.getThrottle(),
                        r.getRoll(),
                        r.getPitch(),
                        r.getYaw()
                    )
                );
            }

            renderMotorMixRules();
            FC.OUTPUT_MAPPING.invalidateDirectAssignment();
            renderOutputMapping();

            motorWizardModal.close();
            saveAndReboot();
        });

        // Reset wizard when modal opens
        motorWizardModal.options.onOpen = function() {
            const positions = WIZARD_MOTOR_POSITIONS[currentMixerPreset.image];
            if (!positions) {
                motorWizardModal.close();
                return;
            }
            resetWizard(positions.length);
            loadWizardSettings();

            // Update preview image
            const $wizardImg = $('#wizard-preview-img');
            const $mainImg = $('#motor-mixer-preview-img');
            if ($mainImg.attr('src')) {
                $wizardImg.attr('src', $mainImg.attr('src'));
            }

            buildPositionButtons(positions);
        };

        // Clean up when modal closes
        motorWizardModal.options.onClose = function() {
            stopMotors();
            wizardState.isActive = false;
            resumeBackgroundPolling();

            // Restore DShot beeper if it was enabled before the wizard
            if (wizardState.savedDshotBeeper) {
                mspHelper.setSetting('dshot_beeper_enabled', wizardState.savedDshotBeeper);
                wizardState.savedDshotBeeper = null;
            }
        };

        const updateMotorDirection = function () {
            let motorDirectionCheckbox = $('input[name=motor_direction_inverted]:checked');
            const isReversed = motorDirectionCheckbox.val() == 1 && (FC.MIXER_CONFIG.platformType == PLATFORM.MULTIROTOR || FC.MIXER_CONFIG.platformType == PLATFORM.TRICOPTER);

            import(`./../resources/motor_order/${currentMixerPreset.image}${isReversed ? "_reverse" : ""}.svg`).then(({default: path}) => {
                const $img = $('.mixerPreview img');
                $img.attr('src', path);
                // Wait for image to load before positioning motor numbers
                $img.off('load.motorNumbers').on('load.motorNumbers', function() {
                    labelMotorNumbers();
                });
                // If image is already cached, load event won't fire, so check complete
                if ($img[0].complete) {
                    labelMotorNumbers();
                }
            });

            renderOutputMapping();
        };

        $("#motor_direction_inverted").on('change', updateMotorDirection);
        $("#motor_direction_normal").on('change', updateMotorDirection);

        $platformSelect.find("*").remove();

        for (let i in platforms) {
            if (platforms.hasOwnProperty(i)) {
                let p = platforms[i];
                $platformSelect.append('<option value="' + p.id + '">' + p.name + '</option>');
            }
        }

        $platformSelect.on('change', function () {
            FC.MIXER_CONFIG.platformType = parseInt($platformSelect.val(), 10);
            currentPlatform = platform.getById(FC.MIXER_CONFIG.platformType);

            var $platformSelectParent = $platformSelect.parent('.select');

            fillMixerPreset();
            $mixerPreset.trigger('change');
        });

        currentPlatform = platform.getById(FC.MIXER_CONFIG.platformType);
        $platformSelect.val(FC.MIXER_CONFIG.platformType).trigger('change');

        $mixerPreset.on('change', function () {
            const presetId = parseInt($mixerPreset.val(), 10);
            currentMixerPreset = mixer.getById(presetId);

            FC.MIXER_CONFIG.appliedMixerPreset = presetId;

            const wizardSupported = Object.prototype.hasOwnProperty.call(WIZARD_MOTOR_POSITIONS, currentMixerPreset.image);
            $("#mixer-wizard-gui_box").toggleClass("is-hidden", !wizardSupported);

            if (FC.MIXER_CONFIG.platformType == PLATFORM.AIRPLANE && currentMixerPreset.id != loadedMixerPresetID) {
                $("#needToUpdateMixerMessage").removeClass("is-hidden");
            } else {
                $("#needToUpdateMixerMessage").addClass("is-hidden");
            }

            if (FC.MIXER_CONFIG.platformType == PLATFORM.MULTIROTOR || FC.MIXER_CONFIG.platformType == PLATFORM.TRICOPTER) {
                $('#motor_direction_container').removeClass("is-hidden");
                $('#platform-type').parent('.select').removeClass('no-bottom-border');
            } else {
                $('#motor_direction_container').addClass("is-hidden");
                $('#platform-type').parent('.select').addClass('no-bottom-border');
            }

            if (FC.MIXER_CONFIG.platformType !== PLATFORM.MULTIROTOR && FC.MIXER_CONFIG.platformType !== PLATFORM.TRICOPTER) {
                FC.EZ_TUNE.enabled = 0;
                mspHelper.saveEzTune();
            }

            updateRefreshButtonStatus();
            updateMotorDirection();
        });

        if (FC.MIXER_CONFIG.appliedMixerPreset > -1) {
            loadedMixerPresetID = FC.MIXER_CONFIG.appliedMixerPreset;
            $("#needToUpdateMixerMessage").addClass("is-hidden");
            $mixerPreset.val(FC.MIXER_CONFIG.appliedMixerPreset).trigger('change');
        } else {
            $mixerPreset.trigger('change');
        }

        // Re-run after settings load, since configureInputs() is async.
        settingsPromise.then(() => updateMotorDirection());

        modal = new jBox('Modal', {
            width: 480,
            height: 240,
            closeButton: 'title',
            animation: false,
            attach: $('#load-and-apply-mixer-button'),
            title: i18n.getMessage("mixerApplyModalTitle"),
            content: $('#mixerApplyContent')
        });

        servoTargetWarningModal = new jBox('Modal', {
            width: 480,
            height: 200,
            closeButton: 'title',
            animation: false,
            title: i18n.getMessage("servoMixRuleInvalidServoTargetTitle"),
            content: $('#servoTargetWarningContent')
        });

        $('#execute-button').on('click', function () {
            loadedMixerPresetID = currentMixerPreset.id;
            mixer.loadServoRules(FC, currentMixerPreset);
            mixer.loadMotorRules(FC, currentMixerPreset);
            FC.MIXER_CONFIG.hasFlaps = (currentMixerPreset.hasFlaps === true) ? true : false;
            renderServoMixRules();
            renderMotorMixRules();
            renderOutputMapping();
            modal.close();
            saveAndReboot();
        });

        $('#load-mixer-button').on('click', function () {
            if (FC.MIXER_CONFIG.platformType == PLATFORM.AIRPLANE) {
                $("#needToUpdateMixerMessage").addClass("is-hidden");
            }
            loadedMixerPresetID = currentMixerPreset.id;
            mixer.loadServoRules(FC, currentMixerPreset);
            mixer.loadMotorRules(FC, currentMixerPreset);
            FC.MIXER_CONFIG.hasFlaps = (currentMixerPreset.hasFlaps === true) ? true : false;
            renderServoMixRules();
            renderMotorMixRules();
            FC.OUTPUT_MAPPING.invalidateDirectAssignment();
            renderOutputMapping();
            updateRefreshButtonStatus();
        });

        $('#refresh-mixer-button').on('click', function () {
            currentMixerPreset = mixer.getById(loadedMixerPresetID);
            FC.MIXER_CONFIG.platformType = currentMixerPreset.platform;
            currentPlatform = platform.getById(FC.MIXER_CONFIG.platformType);
            $platformSelect.val(FC.MIXER_CONFIG.platformType).trigger('change');
            $mixerPreset.val(loadedMixerPresetID).trigger('change');
            renderServoMixRules();
            renderMotorMixRules();
            renderOutputMapping();
        });

        $servoMixTableBody.on('click', "[data-role='role-servo-delete']", function (event) {
            FC.SERVO_RULES.drop($(event.currentTarget).attr("data-index"));
            renderServoMixRules();
            FC.OUTPUT_MAPPING.invalidateDirectAssignment();
            renderOutputMapping();
        });

        $motorMixTableBody.on('click', "[data-role='role-motor-delete']", function (event) {
            FC.MOTOR_RULES.drop($(event.currentTarget).attr("data-index"));
            renderMotorMixRules();
            FC.OUTPUT_MAPPING.invalidateDirectAssignment();
            renderOutputMapping();
        });

        $servoMixTableBody.on('change', "input", function (event) {
            renderOutputMapping();
        });

        $("[data-role='role-servo-add']").on('click', function () {
            if (FC.SERVO_RULES.hasFreeSlots()) {
                FC.SERVO_RULES.put(new ServoMixRule(FC.SERVO_RULES.getNextUnusedIndex(), 0, 100, 0));
                renderServoMixRules();
                FC.OUTPUT_MAPPING.invalidateDirectAssignment();
                renderOutputMapping();
            }
        });

        $("[data-role='role-motor-add']").on('click', function () {
            if (FC.MOTOR_RULES.hasFreeSlots()) {
                FC.MOTOR_RULES.put(new MotorMixRule(1, 0, 0, 0));
                renderMotorMixRules();
                FC.OUTPUT_MAPPING.invalidateDirectAssignment();
                renderOutputMapping();
            }
        });

        $("[data-role='role-logic-conditions-open']").on('click', function () {
            FC.LOGIC_CONDITIONS.open();
        });

        $('#save-button').on('click', saveAndReboot);

        renderServoMixRules();
        renderMotorMixRules();

        renderOutputTable();
        renderOutputMapping();

        // Attempt to enhance output preview with firmware-authoritative assignments.
        // Tab is already functional above; this re-renders if/when firmware responds.
        // The settled guard handles the edge case of a malformed packet causing no callback.
        {
            let settled = false;
            const onOutputAssignmentLoaded = function() {
                if (settled) return;
                settled = true;
                renderOutputMapping();
            };
            mspHelper.loadOutputAssignment(onOutputAssignmentLoaded);
            setTimeout(onOutputAssignmentLoaded, 2000);
        }

        FC.LOGIC_CONDITIONS.init($('#logic-wrapper'));

        i18n.localize();;

        interval.add('logic_conditions_pull', getLogicConditionsStatus, 350);

        // configureInputs() populates radio buttons asynchronously via MSP.
        // The synchronous $mixerPreset.trigger('change') above fires before
        // those requests complete, so re-run once the real values are in.
        settingsPromise.then(() => updateMotorDirection())
            .catch((error) => console.error('Settings load failed, motor direction not updated:', error));

        GUI.content_ready(callback);
    }

    function updateRefreshButtonStatus() {
        if (
            (currentMixerPreset.id != loadedMixerPresetID && mixer.getById(loadedMixerPresetID).platform == PLATFORM.AIRPLANE) ||
            (currentMixerPreset.id == loadedMixerPresetID && currentMixerPreset.platform == PLATFORM.AIRPLANE)
           ) {
            $("#refresh-mixer-button").parent().removeClass("is-hidden");
        } else {
            $("#refresh-mixer-button").parent().addClass("is-hidden");
        }
    }

    function getLogicConditionsStatus() {
        mspHelper.loadLogicConditionsStatus(onStatusPullDone);
    }

    function onStatusPullDone() {
        FC.LOGIC_CONDITIONS.update(FC.LOGIC_CONDITIONS_STATUS);
    }

};

mixerTab.cleanup = function (callback) {
    //delete modal;
    //delete motorWizardModal;
    $('.jBox-wrapper').remove();
    if (callback) callback();
};

export default mixerTab;
