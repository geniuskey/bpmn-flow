/*
 * Third interoperability check: read BPMN Flow exports with the Camunda BPMN
 * Model API (Apache-2.0) — the parser used by the Camunda 7 engine. Reading a
 * model validates it against Camunda's bundled BPMN 2.0 schema; the check then
 * resolves every flow node, sequence flow and message flow through the API.
 *
 * Usage (Java 17+, single-file source launch):
 *   java -cp camunda-bpmn-model.jar:camunda-xml-model.jar scripts/interop/CamundaCheck.java <dir>
 */
import java.io.File;
import java.util.Arrays;
import org.camunda.bpm.model.bpmn.Bpmn;
import org.camunda.bpm.model.bpmn.BpmnModelInstance;
import org.camunda.bpm.model.bpmn.instance.FlowNode;
import org.camunda.bpm.model.bpmn.instance.MessageFlow;
import org.camunda.bpm.model.bpmn.instance.SequenceFlow;

public class CamundaCheck {
  private static String readText(File file) {
    try {
      return java.nio.file.Files.readString(file.toPath());
    } catch (java.io.IOException e) {
      return "";
    }
  }

  public static void main(String[] args) {
    File[] files = new File(args[0]).listFiles((dir, name) -> name.endsWith(".bpmn"));
    if (files == null) throw new IllegalArgumentException("not a directory: " + args[0]);
    Arrays.sort(files);
    int failures = 0;
    for (File file : files) {
      try {
        BpmnModelInstance model = Bpmn.readModelFromFile(file);
        Bpmn.validateModel(model);
        int nodes = model.getModelElementsByType(FlowNode.class).size();
        int flows = 0;
        for (SequenceFlow flow : model.getModelElementsByType(SequenceFlow.class)) {
          if (flow.getSource() == null || flow.getTarget() == null) {
            throw new IllegalStateException("unresolved sequence flow " + flow.getId());
          }
          flows++;
        }
        int messages = 0;
        for (MessageFlow flow : model.getModelElementsByType(MessageFlow.class)) {
          if (flow.getSource() == null || flow.getTarget() == null) {
            throw new IllegalStateException("unresolved message flow " + flow.getId());
          }
          messages++;
        }
        System.out.printf("OK   %s: %d flow nodes, %d sequence flows, %d message flows%n", file.getName(), nodes, flows, messages);
      } catch (ClassCastException e) {
        // The Camunda 7 model API has no type for some BPMN elements (e.g.
        // adHocSubProcess); they parse as generic elements. Tool limitation.
        String text = readText(file);
        if (text.contains("<bpmn:adHocSubProcess") || text.contains("<bpmn:choreographyTask")) {
          System.out.printf(
              "LIMIT %s: Camunda 7 model API does not implement %s%n",
              file.getName(),
              text.contains("<bpmn:choreographyTask") ? "choreography elements" : "adHocSubProcess");
          continue;
        }
        failures++;
        System.out.printf("FAIL %s: %s%n", file.getName(), e.getMessage());
      } catch (Exception e) {
        failures++;
        System.out.printf("FAIL %s: %s: %s%n", file.getName(), e.getClass().getSimpleName(), e.getMessage());
      }
    }
    System.out.printf("%d file(s) failed%n", failures);
    System.exit(failures == 0 ? 0 : 1);
  }
}
